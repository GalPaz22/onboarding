import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

// Optional dependencies (loaded dynamically if installed)
let GoogleGenAI = null;
try {
  const mod = await import('@google/genai');
  GoogleGenAI = mod.GoogleGenAI || mod.default || null;
} catch {}

let OpenAIEmbeddings = null;
try {
  const mod = await import('@langchain/openai');
  OpenAIEmbeddings = mod.OpenAIEmbeddings || (mod.default && mod.default.OpenAIEmbeddings) || null;
} catch {}

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI;
const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const LOCK_DIR = os.tmpdir();

const __filename = fileURLToPath(import.meta.url);

const getLockFilePath = (dbName) => path.join(LOCK_DIR, `reprocessing_${dbName}.lock`);

// Initialize Google AI if available
const ai = GOOGLE_AI_API_KEY && GOOGLE_AI_API_KEY !== "YOUR_GOOGLE_AI_KEY" && GoogleGenAI
  ? new GoogleGenAI({ apiKey: GOOGLE_AI_API_KEY })
  : null;

// Initialize OpenAI embeddings if available
const embeddings = OPENAI_API_KEY && OPENAI_API_KEY !== "YOUR_OPENAI_API_KEY" && OpenAIEmbeddings
  ? new OpenAIEmbeddings({
      model: "text-embedding-3-large",
      apiKey: OPENAI_API_KEY
    })
  : null;

/** Helper function to parse prices consistently */
function parsePrice(priceValue) {
  if (priceValue === null || priceValue === undefined || priceValue === '') {
    return 0;
  }
  if (typeof priceValue === 'number') {
    return isNaN(priceValue) ? 0 : priceValue;
  }
  let cleanPrice = String(priceValue);
  cleanPrice = cleanPrice.replace(/[$₪€£¥,\s]/g, '');
  cleanPrice = cleanPrice.replace(/[^\d.-]/g, '');
  if (cleanPrice === '' || cleanPrice === '-' || cleanPrice === '.') {
    return 0;
  }
  const numericPrice = parseFloat(cleanPrice);
  const result = isNaN(numericPrice) ? 0 : numericPrice;
  return result < 0 ? 0 : result;
}

function isValidImageUrl(url) {
  if (typeof url !== "string") return false;
  try { new URL(url); } catch { return false; }
  return /\.(jpe?g|png|gif|webp)$/i.test(url);
}

/** Process and normalize variants for both WooCommerce and Shopify */
function processProductVariants(product) {
  // If this is already a processed MongoDB document with variant data, preserve it
  if (product.variants && Array.isArray(product.variants) && 
      product.sizes && Array.isArray(product.sizes) && 
      product.colors && Array.isArray(product.colors)) {
    return {
      variants: product.variants,
      sizes: product.sizes,
      colors: product.colors
    };
  }

  // Handle Shopify variants (GraphQL structure)
  if (product.variants?.edges) {
    const variants = product.variants.edges.map(({ node }) => {
      const optMap = Object.fromEntries((node.selectedOptions || []).map(o => [o.name?.toLowerCase(), o.value]));
      return {
        id: node.id,
        title: node.title,
        sku: node.sku || null,
        price: parsePrice(node.price),
        compareAtPrice: parsePrice(node.compareAtPrice),
        image: node.image?.src || null,
        size: optMap['size'] || optMap['eu size'] || optMap['us size'] || null,
        color: optMap['color'] || optMap['colour'] || null,
        options: node.selectedOptions || [],
        inventoryQuantity: node.inventoryQuantity || 0,
        availableForSale: node.availableForSale || false
      };
    });

    const sizes = [...new Set(variants.map(v => v.size).filter(Boolean))].sort();
    const colors = [...new Set(variants.map(v => v.color).filter(Boolean))];

    return { variants, sizes, colors };
  }

  // Handle WooCommerce variants (if they exist)
  if (product.variations && Array.isArray(product.variations)) {
    const variants = product.variations.map(variation => ({
      id: variation.id,
      title: variation.description || `${product.name} - Variation`,
      sku: variation.sku || null,
      price: parsePrice(variation.price),
      regular_price: parsePrice(variation.regular_price),
      sale_price: parsePrice(variation.sale_price),
      image: variation.image?.src || null,
      attributes: variation.attributes || [],
      stock_status: variation.stock_status || 'instock',
      stock_quantity: variation.stock_quantity || 0,
      manage_stock: variation.manage_stock || false
    }));

    const allAttributes = variants.flatMap(v => v.attributes || []);
    const sizes = [...new Set(allAttributes.filter(attr => 
      attr.name?.toLowerCase().includes('size')).map(attr => attr.option))].filter(Boolean);
    const colors = [...new Set(allAttributes.filter(attr => 
      attr.name?.toLowerCase().includes('color') || attr.name?.toLowerCase().includes('colour')).map(attr => attr.option))].filter(Boolean);

    return { variants, sizes, colors };
  }

  return { variants: [], sizes: [], colors: [] };
}

// Helper function to fetch image as base64
async function fetchImageAsBase64(imageUrl) {
  try {
    console.log(`📥 Fetching image: ${imageUrl}`);
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.warn(`❌ Failed to fetch image: ${imageUrl}, status: ${response.status}`);
      return null;
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    
    // Determine MIME type from URL or response
    let mimeType = 'image/jpeg'; // default
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.startsWith('image/')) {
      mimeType = contentType;
    } else {
      // Guess from URL extension
      if (imageUrl.match(/\.(png)$/i)) mimeType = 'image/png';
      else if (imageUrl.match(/\.(gif)$/i)) mimeType = 'image/gif';
      else if (imageUrl.match(/\.(webp)$/i)) mimeType = 'image/webp';
    }
    
    console.log(`✅ Successfully fetched and converted image: ${imageUrl} (${mimeType}, ${Math.round(base64.length / 1024)}KB)`);
    return { data: base64, mimeType };
  } catch (error) {
    console.warn(`❌ Error fetching image ${imageUrl}:`, error.message);
    return null;
  }
}

// Image description function with proper base64 handling
async function describeImages(product) {
  console.log(`🖼️ Starting Gemini image analysis for product: ${product.name}`);
  
  if (!ai) {
    console.warn("❌ Google AI client not initialized - falling back to basic description");
    return `Product: ${product.name}. Description not available due to missing AI configuration.`;
  }

  let imageUrls = [];
  // Case 1: product.images is a valid array of objects with .src
  if (product.images && Array.isArray(product.images) && product.images.length > 0) {
    console.log(`📷 Found 'images' array with ${product.images.length} items.`);
    imageUrls = product.images
      .map(img => img && img.src) // Extract src
      .filter(src => src && isValidImageUrl(src)); // Filter for valid URLs
  } 
  // Case 2: product.image is a valid string URL
  else if (product.image && typeof product.image === 'string' && isValidImageUrl(product.image)) {
    console.log(`📷 Found 'image' string: ${product.image}`);
    imageUrls = [product.image];
  }

  const validImages = imageUrls.slice(0, 3);

  console.log(`🖼️ Found ${validImages.length} valid images for ${product.name}`);
  if (validImages.length > 0) {
    console.log(`🖼️ Image URLs: ${validImages.map(img => img.src).join(', ')}`);
  }

  if (validImages.length === 0) {
    console.log(`⚠️ No valid images available for analysis for ${product.name}`);
    return `Product: ${product.name}. No valid images available for analysis.`;
  }

  try {
    console.log(`📥 Fetching and converting ${validImages.length} images to base64 for ${product.name}...`);
    
    // Fetch and convert images to base64
    const imagePromises = validImages.map(url => fetchImageAsBase64(url));
    const imageResults = await Promise.all(imagePromises);
    const validBase64Images = imageResults.filter(result => result !== null);

    console.log(`✅ Successfully converted ${validBase64Images.length}/${validImages.length} images to base64 for ${product.name}`);

    if (validBase64Images.length === 0) {
      console.log(`❌ Failed to fetch any images for analysis for ${product.name}`);
      return `Product: ${product.name}. Failed to fetch images for analysis.`;
    }

    const messages = [
      {
        role: "user",
        parts: [
          {
            text: `You are an AI data specialist for e-commerce semantic search.
Create a keyword-rich, factual, and objective description in English, optimized for embeddings.
Analyze the provided text and images to extract key attributes like design, shape, colors, materials, and unique features.

Product Name: ${product.name}

Provide ONLY the optimized product description as a plain text response.`
          },
          ...validBase64Images.map(img => ({
            inlineData: {
              mimeType: img.mimeType,
              data: img.data
            }
          }))
        ]
      }
    ];

    console.log(`🤖 Sending ${validBase64Images.length} images to Gemini for analysis of ${product.name}...`);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: messages,
    });

    let result;
    if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
      result = response.candidates[0].content.parts[0].text;
    } else if (response.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
      result = response.response.candidates[0].content.parts[0].text;
    }

    const finalResult = result?.trim() || `Product: ${product.name}. Image analysis completed but no description generated.`;
    
    console.log(`✅ Gemini image analysis completed for ${product.name}`);
    console.log(`📝 Generated description (${finalResult.length} chars): ${finalResult.substring(0, 100)}${finalResult.length > 100 ? '...' : ''}`);
    
    return finalResult;

  } catch (error) {
    console.warn(`❌ Gemini image description failed for ${product.name}:`, error);
    return `Product: ${product.name}. Image analysis failed: ${error.message}`;
  }
}

// Simplified embedding function from processWooImages
async function embed(text) {
  try { 
    return await embeddings.embedQuery(text); 
  } catch (e) { 
    console.warn("Embedding failed:", e); 
    return null; 
  }
}

// Translation function to translate Hebrew text to English before embedding
async function translateToEnglish(text) {
  if (!ai) {
    console.warn("Google AI client not initialized - translation not available");
    return text;
  }

  if (!text || typeof text !== 'string' || text.trim() === '') {
    return text;
  }

  try {
    const messages = [
      {
        role: "user",
        parts: [{
          text: `Translate the following text to English and enhance it for e-commerce search.
Rules:
1. Preserve ALL information from the original text - do not shorten or summarize
2. Make it keyword-rich and factual
3. Keep all details, specifications, and features
4. Expand abbreviations if needed but keep everything
5. If already in English, still enhance it for better searchability
6. Only return the translated/enhanced text, no additional commentary

Text to translate and enhance:
${text}`
        }]
      }
    ];

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: messages,
    });

    let result;
    if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
      result = response.candidates[0].content.parts[0].text;
    } else if (response.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
      result = response.response.candidates[0].content.parts[0].text;
    }

    return result?.trim() || text;

  } catch (error) {
    console.warn("Translation failed:", error);
    return text; // Return original text if translation fails
  }
}

// Simplified metadata summarization from processWooImages
async function summarizeMetadata(metadata) {
  if (!metadata || !Array.isArray(metadata)) return '';
  try {
    if (!ai) {
      console.warn("Google AI client not initialized - metadata summarization not available");
      return '';
    }
    const metadataString = JSON.stringify(metadata);
    const messages = [
      {
        role: 'user',
        parts: [{
          text: `Given the following product metadata in JSON format, iterate over each key-value pair and output a summary string that only includes the important details for product embedding. 
Metadata: ${metadataString}
Only include details that are relevant for product description embedding. Please provide only the values of the keys, not the keys themselves.`
        }]
      }
    ];
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: messages,
    });
    
    let result;
    if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
      result = response.candidates[0].content.parts[0].text;
    } else if (response.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
      result = response.response.candidates[0].content.parts[0].text;
    }
    return result?.trim() || '';
  } catch (error) {
    console.warn('Gemini metadata summarization failed:', error.message);
    return '';
  }
}

// Simplified classification function from processWooImages
async function classify(text, name, categories, types, softCategories, variants = [], imageForContext = null) {
  const categoriesArray = Array.isArray(categories) ? categories : [];
  const typesArray = Array.isArray(types) ? types : [];
  const softCategoriesArray = Array.isArray(softCategories) ? softCategories : [];
  
  const categoryList = categoriesArray.join(", ");
  const typeList = typesArray.join(", ");
  const softCategoryList = softCategoriesArray.join(", ");

  if (!ai) {
    console.warn("Google AI client not initialized - falling back to basic classification");
    return { category: [], type: [], softCategory: [] };
  }

  // Prepare variant information
  let variantInfo = '';
  if (variants && variants.length > 0) {
    const variantDetails = variants.map(v => {
      const details = [];
      if (v.title) details.push(`Title: ${v.title}`);
      if (v.sku) details.push(`SKU: ${v.sku}`);
      if (v.size) details.push(`Size: ${v.size}`);
      if (v.color) details.push(`Color: ${v.color}`);
      if (v.price) details.push(`Price: ${v.price}`);
      if (v.options && v.options.length > 0) {
        const options = v.options.map(opt => `${opt.name}: ${opt.value}`).join(', ');
        details.push(`Options: ${options}`);
      }
      return details.join(', ');
    }).join('\n');
    
    variantInfo = `\n\nProduct Variants (${variants.length} total):\n${variantDetails}`;
  }

  const promptText = `You are an AI e-commerce assistant. Classify the product based on its description, image, and variant information.
Follow these rules:
1. Category MUST be an array of one or more categories from this EXACT list: [${categoryList}].
2. If NO category from the list is a suitable match, you MUST return an empty array for the "category" field.
3. Type MUST be an array from: [${typeList}]. If no match, return an empty array.
4. Soft Category MUST be an array from: [${softCategoryList}]. If no match, return an empty array.
5. If the soft category is a color, analyze the image and ALL available variants to return the dominant colors available!
6. Use the product image and variant information (colors, sizes, options) to enhance your classification accuracy.
7. Always return the *single most dominant* color of the product and the products variants!
8. if you find a soft category called 'חלק' find the products with solid colors, w/o patterns or stripes.
9. Do NOT invent new categories, types, or soft categories.

Product Name: ${name}
Description:
${text}${variantInfo}

Return ONLY a JSON object like: {"category": ["The Category"], "type": ["The Type"], "softCategory": ["The Soft Category"]}`;

  const messageParts = [{ text: promptText }];
  if (imageForContext) {
    console.log(`🖼️ Using image in classification for ${name}`);
    messageParts.push({
      inlineData: {
        mimeType: imageForContext.mimeType,
        data: imageForContext.data
      }
    });
  }

  const messages = [
    {
      role: "user",
      parts: messageParts
    }
  ];

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: messages,
      config: {
        responseMimeType: "application/json",
        thinkingConfig: {
          thinkingBudget: 0
        }
      },
    });

    let result;
    if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
      result = response.candidates[0].content.parts[0].text;
    } else if (response.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
      result = response.response.candidates[0].content.parts[0].text;
    }

    if (!result) throw new Error("No valid response from Gemini");

    let jsonString = result.trim();
    if (jsonString.startsWith('```') && jsonString.endsWith('```')) {
      jsonString = jsonString.replace(/^```(?:json)?\s*|```\s*$/g, '');
    }
    const out = JSON.parse(jsonString);

    // Validate against allowed values
    if (out.category && Array.isArray(out.category)) {
      out.category = out.category.filter(c => categoriesArray.includes(c));
    } else {
      out.category = [];
    }
    if (out.type && Array.isArray(out.type)) {
      out.type = out.type.filter(t => typesArray.includes(t));
    } else {
      out.type = [];
    }
    if (out.softCategory && Array.isArray(out.softCategory)) {
      out.softCategory = out.softCategory.filter(s => softCategoriesArray.includes(s));
    } else {
      out.softCategory = [];
    }
    
    return out;

  } catch (error) {
    console.warn(`Classification failed for ${name}:`, error);
    return { category: [], type: [], softCategory: [] };
  }
}

/**
 * Get the best available description from a product
 */
function getProductDescription(product) {
  if (product.description && typeof product.description === 'string' && product.description.trim() !== '') {
    return product.description;
  }
  
  if (product.short_description && typeof product.short_description === 'string' && product.short_description.trim() !== '') {
    return product.short_description;
  }
  
  if (product.name && typeof product.name === 'string' && product.name.trim() !== '') {
    return product.name;
  }
  
  return '';
}

/**
 * Find products with no embeddings that need reprocessing
 */
async function findProductsWithoutEmbeddings(dbName, limit = 100) {
  const client = new MongoClient(MONGO_URI, { 
    connectTimeoutMS: 60000,
    serverSelectionTimeoutMS: 60000,
    socketTimeoutMS: 60000,
    maxPoolSize: 10,
    retryWrites: true,
    retryReads: true
  });

  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");
    
    const db = client.db(dbName);
    const collection = db.collection("products");
    
    const query = {
      $or: [
        { embedding: { $exists: false } },
        { embedding: null },
        { embedding: { $size: 0 } },
        { 
          description1: { $exists: true, $ne: "" },
          embedding: { $exists: false }
        }
      ],
      $or: [
        { stockStatus: "instock" },
        { stock_status: "instock" },
        { stockStatus: { $exists: false }, stock_status: { $exists: false } }
      ]
    };
    
    const productsWithoutEmbeddings = await collection.find(query)
      .limit(limit)
      .project({
        _id: 1,
        id: 1,
        name: 1,
        description1: { $ifNull: ["$description1", ""] },
        stockStatus: { $ifNull: ["$stockStatus", "$stock_status"] },
        url: { $ifNull: ["$url", "$permalink"] }
      })
      .toArray();
    
    const totalCount = await collection.countDocuments(query);
    const productsWithEmbeddings = await collection.countDocuments({
      embedding: { $exists: true, $ne: null, $not: { $size: 0 } }
    });
    
    console.log(`📊 Found ${totalCount} total products without embeddings`);
    console.log(`📊 Found ${productsWithEmbeddings} products with embeddings`);
    console.log(`📋 Returning ${productsWithoutEmbeddings.length} products for processing`);
    
    if (productsWithoutEmbeddings.length > 0) {
      console.log(`📋 Example product IDs without embeddings: ${productsWithoutEmbeddings.slice(0, 5).map(p => p.id).join(', ')}`);
    }
    
    return {
      products: productsWithoutEmbeddings,
      totalCount
    };
    
  } catch (error) {
    console.error(`❌ Error finding products without embeddings: ${error.message}`);
    throw error;
  } finally {
    await client.close();
    console.log("✅ Closed MongoDB connection");
  }
}

async function reprocessProducts({ 
  dbName, 
  categories, 
  userTypes, 
  softCategories, 
  targetCategory = null, 
  missingSoftCategoryOnly = false,
  options: initialOptions = {}
}) {
  const isRunningFromCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
  
  let options = { ...initialOptions };
  let cliDbName = dbName;
  
  if (isRunningFromCli) {
    const args = process.argv.slice(2);
    cliDbName = args[0];

    if (!cliDbName) {
      console.error('❌ Error: Database name is required when running from CLI.');
      console.log('Usage: node reprocess-products.js <dbName> [options]');
      process.exit(1);
    }
    
    const parsedArgs = parseCliArgs(args.slice(1));
    options = { ...options, ...parsedArgs.options };
    targetCategory = parsedArgs.targetCategory || targetCategory;
    missingSoftCategoryOnly = parsedArgs.missingSoftCategoryOnly || missingSoftCategoryOnly;
  }
  
  if (!cliDbName) {
    console.error('❌ Error: dbName is required.');
    return;
  }
  
  // If reprocessAll is true, enable all options
  if (options.reprocessAll) {
    options = {
      ...options,
      reprocessHardCategories: true,
      reprocessSoftCategories: true,
      reprocessTypes: true,
      reprocessVariants: true,
      reprocessEmbeddings: true,
      reprocessDescriptions: true,
      translateBeforeEmbedding: true
    };
  }
  const logs = [];
  const lockFilePath = getLockFilePath(cliDbName);
  const safeSoftCategories = Array.isArray(softCategories) ? softCategories : [];
  
  // Helper function to add logs and write to DB
  let statusCol;
  const log = async (message) => {
    logs.push(message);
    console.log(message);
    if (statusCol) {
      try {
        await statusCol.updateOne(
          { dbName: cliDbName },
          { $push: { logs: message } },
          { upsert: true }
        );
      } catch (err) {
        console.error("Failed to write log to DB:", err);
      }
    }
  };

  try {
    await fs.mkdir(LOCK_DIR, { recursive: true });
    await fs.writeFile(lockFilePath, String(process.pid), { flag: 'w' });
    console.log(`Lock file created at: ${lockFilePath}`);
  } catch (error) {
    const errorMsg = `❌ Could not create lock file at ${lockFilePath}: ${error.message}`;
    logs.push(errorMsg);
    console.log(errorMsg);
    return logs;
  }

  await log(`🚀 Starting reprocessing for database: ${cliDbName}`);
  await log(`🔍 Categories: ${categories.join(', ') || 'None'}`);
  await log(`🏷️ User types: ${userTypes.join(', ') || 'None'}`);
  await log(`🎨 Soft categories: ${safeSoftCategories.join(', ') || 'None'}`);
  
  if (targetCategory) {
    await log(`🎯 Target category filter: "${targetCategory}" - will only reprocess products with this category`);
  } else {
    await log(`🌐 Processing all products (no category filter)`);
  }
  if (missingSoftCategoryOnly) {
    await log(`🎨 Special mode: Only targeting products with MISSING softCategory field (not empty arrays)`);
  }
  
  // Log what we're reprocessing
  await log(`\n📋 Reprocessing Options:`);
  await log(`${options.reprocessHardCategories ? '✅' : '❌'} Hard Categories (${options.reprocessHardCategories ? 'WILL' : 'will NOT'} be reprocessed)`);
  await log(`${options.reprocessSoftCategories ? '✅' : '❌'} Soft Categories (${options.reprocessSoftCategories ? 'WILL' : 'will NOT'} be reprocessed)`);
  await log(`${options.reprocessTypes ? '✅' : '❌'} Product Types (${options.reprocessTypes ? 'WILL' : 'will NOT'} be reprocessed)`);
  await log(`${options.reprocessVariants ? '✅' : '❌'} Variants (${options.reprocessVariants ? 'WILL' : 'will NOT'} be reprocessed)`);
  await log(`${options.reprocessEmbeddings ? '✅' : '❌'} Embeddings (${options.reprocessEmbeddings ? 'WILL' : 'will NOT'} be regenerated)`);
  await log(`${options.reprocessDescriptions ? '✅' : '❌'} Descriptions (${options.reprocessDescriptions ? 'WILL' : 'will NOT'} be retranslated/enriched)`);
  await log(`${options.translateBeforeEmbedding ? '✅' : '❌'} Translation (${options.translateBeforeEmbedding ? 'WILL' : 'will NOT'} translate to English before embedding)`);
  
  if (options.reprocessAll) {
    await log(`🔄 FULL REPROCESSING: All components will be updated`);
  }

  const client = new MongoClient(MONGO_URI, { 
    connectTimeoutMS: 60000,
    serverSelectionTimeoutMS: 60000,
    socketTimeoutMS: 60000,
    maxPoolSize: 10,
    retryWrites: true,
    retryReads: true
  });
  
  let runStartedAt = new Date();
  let retryCount = 0;
  const maxRetries = 3;
  
  while (retryCount < maxRetries) {
    try {
      await log(`🔄 Attempting MongoDB connection (attempt ${retryCount + 1}/${maxRetries})`);
      await client.connect();
      await log("✅ Connected to MongoDB");
      break;
    } catch (err) {
      retryCount++;
      await log(`❌ MongoDB connection failed (attempt ${retryCount}/${maxRetries}): ${err.message}`);
      
      if (retryCount >= maxRetries) {
        await log(`❌ Failed to connect to MongoDB after ${maxRetries} attempts`);
        await fs.unlink(lockFilePath);
        return logs;
      }
      
      const waitTime = Math.pow(2, retryCount) * 1000;
      await log(`⏳ Waiting ${waitTime/1000}s before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  // Fetch user data if running from CLI
  if (isRunningFromCli) {
    try {
      const userDb = client.db('users');
      const users = userDb.collection('users');
      const user = await users.findOne({ dbName: cliDbName });
      
      if (user) {
        categories = user.categories || [];
        userTypes = user.types || [];
        softCategories = user.softCategories || [];
        console.log(`👤 Fetched settings for user: ${cliDbName}`);
      } else {
        console.warn(`⚠️ Warning: No user found for dbName "${cliDbName}". Using empty settings.`);
      }
    } catch (err) {
      console.error('❌ Error fetching user settings:', err);
    }
  }

  // Check user's sync mode to determine classification method
  let isImageSyncMode = false;
  try {
    const usersDb = client.db("users");
    const userDoc = await usersDb.collection("users").findOne({ dbName: cliDbName });
    if (userDoc && userDoc.syncMode === "image") {
      isImageSyncMode = true;
      await log("🖼️ Image sync mode detected - will use image-based classification");
    } else {
      await log("📝 Text sync mode detected - will use text-only classification");
    }
  } catch (err) {
    await log(`⚠️ Could not determine sync mode, defaulting to text-only: ${err.message}`);
  }

  // Mark reprocess start on user document
  try {
    await client
      .db("users")
      .collection("users")
      .updateOne(
        { dbName: cliDbName },
        { $set: { reprocessStartedAt: runStartedAt } },
        { upsert: false }
      );
    await log("🕒 Marked reprocess start for user");
  } catch (userErr) {
    await log(`⚠️ Could not update user reprocess start: ${userErr.message}`);
  }

  const db = client.db(cliDbName);
  const collection = db.collection("products");
  statusCol = db.collection("sync_status");

  // Clear existing logs and initialize status
  await statusCol.updateOne(
    { dbName: cliDbName },
    { 
      $set: { 
        dbName: cliDbName, 
        state: "reprocessing", 
        progress: 0, 
        done: 0, 
        startedAt: runStartedAt,
        logs: [] 
      } 
    },
    { upsert: true }
  );

  // Ensure every product has a stamp
  try {
    const initFromFetched = await collection.updateMany(
      { categoryTypeProcessedAt: { $exists: false }, fetchedAt: { $exists: true } },
      [ { $set: { categoryTypeProcessedAt: "$fetchedAt" } } ]
    );
    await log(`🧭 Initialized stamp from fetchedAt for ${initFromFetched.modifiedCount} products`);
  } catch (e) {
    await log(`⚠️ Pipeline update not supported, skipping init-from-fetchedAt: ${e.message}`);
  }

  const initToNow = await collection.updateMany(
    { categoryTypeProcessedAt: { $exists: false } },
    { $set: { categoryTypeProcessedAt: new Date() } }
  );
  await log(`🕒 Initialized missing stamp to now for ${initToNow.modifiedCount} products`);

  await log(`⏱️ Week threshold TEMPORARILY DISABLED - will reprocess all products with embeddings`);
  await log(`🛒 IMPORTANT: All reprocessing will ONLY target IN-STOCK products`);

  // Build query conditions based on sync mode
  let classificationConditions;
  
  if (isImageSyncMode) {
    classificationConditions = {};
    await log("🖼️ Image mode: Will reprocess ALL IN-STOCK products with embeddings");
  } else {
    if (missingSoftCategoryOnly) {
      classificationConditions = {
        $and: [
          { category: { $exists: true } },
          { softCategory: { $exists: false } }
        ]
      };
      await log("🎨 Text mode: Will only process IN-STOCK products with categories but MISSING softCategory field");
    } else {
      classificationConditions = {
        $or: [
          { category: { $exists: false } },
          { category: { $eq: [] } },
          { category: { $eq: null } },
          { type: { $exists: false } },
          { type: { $eq: [] } },
          { type: { $eq: null } },
          { softCategory: { $exists: false } },
          { softCategory: { $eq: [] } },
          { softCategory: { $eq: null } },
        
        ]
      };
      await log("📝 Text mode: Will only process IN-STOCK products missing categories/types");
    }
  }

  // Build the base query - ALWAYS filter for in-stock products only
  const inStockFilter = {
    $or: [
      { stockStatus: "instock" },
      { stock_status: "instock" }
    ]
  };
  
  let baseQuery = {};
  
  if (options.reprocessEmbeddings) {
    baseQuery = {
      $and: [
        inStockFilter,
        {
          $or: [
            { embedding: { $exists: true, $ne: null } },
            { 
              description1: { $exists: true, $ne: "" },
              $or: [
                { embedding: { $exists: false } },
                { embedding: null },
                { embedding: { $size: 0 } }
              ]
            }
          ]
        }
      ]
    };
  } else {
    baseQuery = {
      $and: [
        inStockFilter,
        { embedding: { $exists: true, $ne: null } }
      ]
    };
  }

  let finalQuery;
  if (isImageSyncMode) {
    finalQuery = baseQuery;
    await log("🖼️ Image mode: Processing all IN-STOCK products with embeddings");
  } else {
    finalQuery = {
      ...baseQuery,
      ...classificationConditions
    };
    
    if (!missingSoftCategoryOnly) {
      await log("📝 Text mode: Processing IN-STOCK products missing categories/types");
    }
  }

  // Add category filtering if targetCategory is specified
  if (targetCategory) {
    finalQuery = {
      ...finalQuery,
      category: { $in: [targetCategory] }
    };
    await log(`🎯 Added category filter: only products with category "${targetCategory}" will be processed`);
  }

  await log(`🔍 Final MongoDB query: ${JSON.stringify(finalQuery, null, 2)}`);
  
  const productsToProcess = await collection.find(finalQuery).toArray();
  
  const totalToProcess = productsToProcess.length;
  await statusCol.updateOne(
    { dbName: cliDbName },
    { $set: { state: totalToProcess > 0 ? "reprocessing" : "idle", total: totalToProcess } }
  );

  await log(`🔄 Processing ${totalToProcess} products for enrichment`);
  if (totalToProcess === 0) {
    if (isImageSyncMode) {
      await log("✅ Nothing to do. No products with embeddings found for image-based reprocessing.");
    } else if (missingSoftCategoryOnly) {
      await log("✅ Nothing to do. No products found with categories but missing softCategory field.");
    } else {
      await log("✅ Nothing to do. All products with embeddings already have category/type data.");
    }
  }

  let done = 0;
  for (const product of productsToProcess) {
    try {
      await fs.access(lockFilePath);
    } catch (error) {
      await log("🛑 Reprocessing stopped by user.");
      await statusCol.updateOne(
        { dbName: cliDbName },
        { $set: { state: "idle", stoppedAt: new Date() } }
      );
      break;
    }

    try {
      await log(`\n🟡 Processing: ${product.name} (ID: ${product.id})`);
      const { name, categories: productCategories, metadata, images, image } = product; // Added image
      const originalDescription = getProductDescription(product);

      if (!originalDescription || originalDescription.trim() === "") {
        await log("⚠️ Skipping - no original description found");
        await collection.updateOne(
          { _id: product._id },
          { $set: { categoryTypeProcessedAt: new Date() } }
        );
      } else {
        // Initialize updateData
        const updateData = {
          categoryTypeProcessedAt: new Date(),
          url: product.url || product.permalink || product.link || null,
          image: product.image || (product.images && product.images.length > 0 ? product.images[0].src : null)
        };
        
        // Always convert price fields to numbers properly
        if (product.price) updateData.price = parsePrice(product.price);
        if (product.regular_price) updateData.regular_price = parsePrice(product.regular_price);
        if (product.sale_price) updateData.sale_price = parsePrice(product.sale_price);
        
        // Process variants if enabled
        let variantData = { variants: [], sizes: [], colors: [] };
        if (options.reprocessVariants) {
          variantData = processProductVariants(product);
          await log(`🔧 Processed variants for ${name}: ${variantData.variants.length} variants, ${variantData.sizes.length} sizes, ${variantData.colors.length} colors`);
          
          updateData.variants = variantData.variants;
          updateData.sizes = variantData.sizes;
          updateData.colors = variantData.colors;
        }
        
        // Create enriched description
        let enrichedDescription = product.description || originalDescription;

        if (options.reprocessDescriptions) {
          const hasPluralImages = images && Array.isArray(images) && images.length > 0;
          const hasSingularImage = image && typeof image === 'string';
          
          await log(`🔍 Image mode check for ${name}: isImageSyncMode=${isImageSyncMode}, has 'images' array=${hasPluralImages}, has 'image' string=${hasSingularImage}`);
          
          if (isImageSyncMode && (hasPluralImages || hasSingularImage)) {
            // Use image-based description for image sync mode
            await log(`🖼️ Creating image-based description for ${name}`);
            const imageDescription = await describeImages(product);
            
            // Add metadata and category info
            let metadataAppend = '';
            
            // Handle WooCommerce metadata
            if (metadata && Array.isArray(metadata)) {
              metadataAppend = await summarizeMetadata(metadata);
            }
            
            // Handle Shopify-specific fields
            if (product.productType) {
              metadataAppend += `${metadataAppend ? '\n' : ''}Product Type: ${product.productType}`;
            }
            if (product.vendor) {
              metadataAppend += `${metadataAppend ? '\n' : ''}Vendor: ${product.vendor}`;
            }
            if (product.tags && Array.isArray(product.tags) && product.tags.length > 0) {
              metadataAppend += `${metadataAppend ? '\n' : ''}Tags: ${product.tags.join(', ')}`;
            }

            let categoryAppend = '';
            if (productCategories && Array.isArray(productCategories)) {
              categoryAppend = productCategories
                .filter(cat => cat.name)
                .map(cat => cat.name)
                .join('\n');
            }

            enrichedDescription = `${imageDescription}\n\n${metadataAppend}\n\n${categoryAppend}`.trim();
            updateData.description1 = enrichedDescription;
            await log(`✅ Generated image-based enriched description for ${name} (${enrichedDescription.length} chars)`);
          } else {
            // Use original description with metadata
            let metadataAppend = '';
            
            // Handle WooCommerce metadata
            if (metadata && Array.isArray(metadata)) {
              metadataAppend = await summarizeMetadata(metadata);
            }
            
            // Handle Shopify-specific fields
            if (product.productType) {
              metadataAppend += `${metadataAppend ? '\n' : ''}Product Type: ${product.productType}`;
            }
            if (product.vendor) {
              metadataAppend += `${metadataAppend ? '\n' : ''}Vendor: ${product.vendor}`;
            }
            if (product.tags && Array.isArray(product.tags) && product.tags.length > 0) {
              metadataAppend += `${metadataAppend ? '\n' : ''}Tags: ${product.tags.join(', ')}`;
            }

            let categoryAppend = '';
            if (productCategories && Array.isArray(productCategories)) {
              categoryAppend = productCategories.map(c => c.name).join(' ');
            }

            enrichedDescription = `${originalDescription}\n\n${metadataAppend}\n\n${categoryAppend}`.trim();
            updateData.description1 = enrichedDescription;
            await log(`✅ Generated text-based enriched description for ${name} (${enrichedDescription.length} chars)`);
          }
        }
        
        // Translate description if enabled (do this before embedding)
        if (options.translateBeforeEmbedding && options.reprocessDescriptions) {
          try {
            await log(`🌐 Translating description to English for ${name}`);
            const translatedDescription = await translateToEnglish(enrichedDescription);
            if (translatedDescription && translatedDescription !== enrichedDescription) {
              enrichedDescription = translatedDescription;
              updateData.description1 = enrichedDescription;
              await log(`✅ Translation completed and saved to description1 for ${name}`);
            } else {
              await log(`⚠️ Translation returned same text or failed for ${name}`);
            }
          } catch (translationError) {
            await log(`❌ Error translating description: ${translationError.message}`);
          }
        }
        
        // Generate new embedding if enabled
        if (options.reprocessEmbeddings) {
          try {
            await log(`🧮 Generating embedding for ${name}`);
            
            if (embeddings) {
              // Use the (possibly translated) enriched description for embedding
              const embeddingVector = await embed(enrichedDescription);
              if (embeddingVector) {
                updateData.embedding = embeddingVector;
                await log(`✅ Generated new embedding for ${name}${options.translateBeforeEmbedding ? ' (using translated text)' : ''}`);
              } else {
                await log(`⚠️ Failed to generate embedding for ${name}`);
              }
            } else {
              await log(`⚠️ Cannot generate embedding - OpenAI API key not configured`);
            }
          } catch (embeddingError) {
            await log(`❌ Error generating embedding: ${embeddingError.message}`);
          }
        }

        // Initialize with existing product data or defaults
        let gptCategory = product.category || [];
        let productType = product.type || [];
        let softCategory = product.softCategory || [];
        
        // Only perform classification if any classification option is enabled
        if (options.reprocessHardCategories || options.reprocessSoftCategories || options.reprocessTypes) {
          await log(`🔍 Classifying with variants for: ${name}`);

          // Build enriched context for classification (always include metadata even if not reprocessing descriptions)
          let classificationContext = originalDescription;
          
          // Add metadata context for better classification
          let contextMetadata = '';
          
          // Handle WooCommerce metadata
          if (metadata && Array.isArray(metadata)) {
            const metadataSummary = await summarizeMetadata(metadata);
            if (metadataSummary) {
              contextMetadata += `\n${metadataSummary}`;
            }
          }
          
          // Handle Shopify-specific fields
          if (product.productType) {
            contextMetadata += `\nProduct Type: ${product.productType}`;
          }
          if (product.vendor) {
            contextMetadata += `\nVendor: ${product.vendor}`;
          }
          if (product.tags && Array.isArray(product.tags) && product.tags.length > 0) {
            contextMetadata += `\nTags: ${product.tags.join(', ')}`;
          }
          
          // Add categories if available
          if (productCategories && Array.isArray(productCategories)) {
            const categoryNames = productCategories.map(c => c.name).filter(Boolean).join(', ');
            if (categoryNames) {
              contextMetadata += `\nProduct Categories: ${categoryNames}`;
            }
          }
          
          classificationContext = `${originalDescription}${contextMetadata}`.trim();
          await log(`📝 Classification context built with metadata (${classificationContext.length} chars)`);

          // Fetch the primary image for context if in image mode
          let imageForContext = null;
          if (isImageSyncMode) {
            const hasPluralImages = images && Array.isArray(images) && images.length > 0;
            const hasSingularImage = image && typeof image === 'string';
            let imageUrl = null;

            if (hasPluralImages && images[0].src) {
              imageUrl = images[0].src;
            } else if (hasSingularImage) {
              imageUrl = image;
            }

            if (imageUrl) {
              console.log(`🖼️ Fetching primary image for classification context: ${imageUrl}`);
              imageForContext = await fetchImageAsBase64(imageUrl);
            }
          }

          const classificationResult = await classify(
            classificationContext, 
            name, 
            categories, 
            userTypes, 
            safeSoftCategories, 
            variantData.variants,
            imageForContext // Pass the fetched image
          );
          
          // Only update categories that are enabled
          if (options.reprocessHardCategories) {
            updateData.category = classificationResult.category;
            gptCategory = classificationResult.category;
          }
          
          if (options.reprocessTypes) {
            updateData.type = classificationResult.type || [];
            productType = classificationResult.type;
          }
          
          if (options.reprocessSoftCategories) {
            updateData.softCategory = classificationResult.softCategory || [];
            softCategory = classificationResult.softCategory;
          }
        }

        await collection.updateOne(
          { _id: product._id },
          { $set: updateData }
        );

        await log(`✅ Classified ${name} as Category: ${(gptCategory || []).join(', ') || 'None'}, Type: ${(productType || []).join(', ') || 'None'}, Soft Category: ${(softCategory || []).join(', ') || 'None'}`);
      }

      // progress tick
      done += 1;
      const progress = totalToProcess > 0 ? Math.round((done / totalToProcess) * 100) : 100;
      await statusCol.updateOne(
        { dbName: cliDbName },
        { $set: { done, progress } }
      );

    } catch (error) {
      await log(`❌ Error processing product ${product.id}: ${error.message}`);
    }
  }

  // Mark reprocess finished
  try {
    await client
      .db("users")
      .collection("users")
      .updateOne(
        { dbName: cliDbName },
        { $set: { lastReprocessAt: new Date(), reprocessFinishedAt: new Date() } },
        { upsert: false }
      );
    await log("🏁 Marked reprocess finished for user");
  } catch (userErr) {
    await log(`⚠️ Could not update user reprocess finish: ${userErr.message}`);
  }

  // Mark status as done
  await statusCol.updateOne(
    { dbName: cliDbName },
    { $set: { state: "done", finishedAt: new Date(), done, progress: 100 } }
  );

  await log("📦 Reprocess summary: processed=" + (productsToProcess?.length || 0));

  await client.close();
  try {
    await fs.unlink(lockFilePath);
  } catch (error) {
    // Ignore errors if the file is already gone
  }
  await log("✅ Closed MongoDB connection");
  return logs;
}

function parseCliArgs(args) {
  const options = {
    reprocessHardCategories: true,
    reprocessSoftCategories: true,
    reprocessTypes: true,
    reprocessVariants: true,
    reprocessEmbeddings: true,
    reprocessDescriptions: true,
    translateBeforeEmbedding: true, // Default to true for Hebrew products
    reprocessAll: false,
  };
  let targetCategory = null;
  let missingSoftCategoryOnly = false;

  args.forEach(arg => {
    if (arg.startsWith('--limit=')) {
      // placeholder for future use
    } else if (arg.startsWith('--target-category=')) {
      targetCategory = arg.split('=')[1];
    } else if (arg === '--missing-soft-category-only') {
      missingSoftCategoryOnly = true;
    } else if (arg === '--skip-enrichment') {
      options.reprocessDescriptions = false;
    } else if (arg === '--skip-embedding') {
      options.reprocessEmbeddings = false;
    } else if (arg === '--skip-translation') {
      options.translateBeforeEmbedding = false;
    } else if (arg === '--force' || arg === '--reprocess-all') {
      options.reprocessAll = true;
    }
  });

  return { options, targetCategory, missingSoftCategoryOnly };
}

// If called directly from the command line, run the function
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  reprocessProducts({}).catch(err => {
    console.error("❌ Unhandled error in reprocessProducts:", err);
    process.exit(1);
  });
}

// Export functions
export default reprocessProducts;
export {
  reprocessProducts,
  findProductsWithoutEmbeddings,
  describeImages,
  summarizeMetadata,
  translateToEnglish
};
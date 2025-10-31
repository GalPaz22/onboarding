const { MongoClient } = require("mongodb");
const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;
const { OpenAI } = require("openai");
const { OpenAIEmbeddings } = require("@langchain/openai");
const { parse } = require("node-html-parser");
const { GoogleGenAI, Type } = require('@google/genai');

const MONGO_URI = process.env.MONGODB_URI;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-large",
  apiKey: OPENAI_API_KEY,
});

// Initialize Google AI if you have the API key
const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;
const ai = GOOGLE_AI_API_KEY && GOOGLE_AI_API_KEY !== "YOUR_GOOGLE_AI_KEY" 
  ? new GoogleGenAI({apiKey: GOOGLE_AI_API_KEY})
  : null;

/** Convert HTML to plain text */
function parseHtmlToPlainText(html) {
  if (!html) return "";
  
  const root = parse(html);
  let text = root.textContent || root.innerHTML || "";
  
  // Fallback: manual HTML tag removal
  if (!text) {
    text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  
  console.log("🔍 HTML input length:", html?.length || 0);
  console.log("🔍 Extracted text length:", text?.length || 0);
  
  return text;
}

/** Translate description using OpenAI */
async function translateDescription(description) {
  console.log("🌐 Translation input length:", description?.length || 0);
  
  if (!description || description.trim() === "") {
    console.log("❌ No description provided to translate");
    return null;
  }

  try {
    // Check if Gemini AI is available
    if (!ai) {
      console.warn("Google AI client not initialized - translation not available");
      return description; // Return original description if Gemini not available
    }

    const messages = [
      {
        role: "user",
        parts: [{
          text: `Translate the following text to English:\n\n${description}`
        }]
      }
    ];

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: messages,
      config: {
        responseMimeType: "text/plain",
        thinkingConfig: {
          thinkingBudget: 0
        }
      },
    });

    // Handle response structure
    let result;
    if (response.candidates && Array.isArray(response.candidates) && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (candidate && candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
        result = candidate.content.parts[0].text;
      }
    } else if (response.response && response.response.candidates && Array.isArray(response.response.candidates) && response.response.candidates.length > 0) {
      const candidate = response.response.candidates[0];
      if (candidate && candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
        result = candidate.content.parts[0].text;
      }
    }
    
    const translated = result?.trim();
    
    console.log("🌐 Translation result length:", translated?.length || 0);
    
    if (!translated || translated === "") {
      console.warn("⚠️ Empty translation result");
      return null;
    }
    
    return translated;
  } catch (error) {
    console.error("❌ Translation failed:", error.message);
    return null;
  }
}

/**
 * Use GPT to iterate over product metadata and return a summary
 * of important details for embedding.
 */
async function summarizeMetadata(metadata) {
  if (!metadata || !Array.isArray(metadata)) return '';
  
  try {
    // Check if Gemini AI is available
    if (!ai) {
      console.warn("Google AI client not initialized - metadata summarization not available");
      return ''; // Return empty string if Gemini not available
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
      model: "gemini-2.5-flash",
      contents: messages,
      config: {
        responseMimeType: "text/plain",
        thinkingConfig: {
          thinkingBudget: 0
        }
      }
    });

    // Handle response structure
    let result;
    if (response.candidates && Array.isArray(response.candidates) && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (candidate && candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
        result = candidate.content.parts[0].text;
      }
    } else if (response.response && response.response.candidates && Array.isArray(response.response.candidates) && response.response.candidates.length > 0) {
      const candidate = response.response.candidates[0];
      if (candidate && candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
        result = candidate.content.parts[0].text;
      }
    }

    return result?.trim() || '';
  } catch (error) {
    console.warn('Gemini metadata summarization failed:', error.message);
    return '';
  }
}

/** Generate embeddings using OpenAIEmbeddings */
async function generateEmbeddings(translatedText) {
  if (!translatedText) return null;
  try {
    const result = await embeddings.embedQuery(translatedText);
    return result;
  } catch (error) {
    console.warn("❌ Embedding generation failed:", error.message);
    return null;
  }
}

/**
 * Parse and validate Gemini API result
 * @param {string} result - The raw text result from Gemini
 * @returns {Object} Parsed classification result
 */
async function parseGeminiResult(result) {
  if (!result) {
    throw new Error("Empty response text from Gemini API");
  }

  console.log("🔍 Raw Gemini result:", result);

  // Extract JSON from markdown code blocks if present
  let jsonString = result.trim();
  
  // Check if the result is wrapped in markdown code blocks
  const codeBlockMatch = jsonString.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    jsonString = codeBlockMatch[1].trim();
    console.log("✅ Extracted JSON from code blocks:", jsonString);
  }

  // Also handle cases where there might be extra text before/after the JSON
  const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonString = jsonMatch[0];
    console.log("✅ Extracted JSON object:", jsonString);
  }

  try {
    const parsedResult = JSON.parse(jsonString);
    
    // Validate the parsed result has the expected structure
    if (typeof parsedResult !== 'object' || parsedResult === null) {
      throw new Error("Invalid JSON structure - expected object");
    }

    console.log("✅ Parsed Gemini result:", parsedResult);

    // Ensure we have the required fields with defaults
    return {
      category: parsedResult.category || null,
      type: Array.isArray(parsedResult.type) ? parsedResult.type : [],
      softCategory: Array.isArray(parsedResult.softCategory) ? parsedResult.softCategory : []
    };
  } catch (jsonError) {
    throw new Error(`Failed to parse Gemini response as JSON: ${jsonError.message}. Cleaned response: ${jsonString}`);
  }
}

/**
 * Use Google Gemini to determine product category and type based on enriched text.
 * @param {string} enrichedText - The product text for classification.
 * @param {string} productName - The name of the product.
 * @param {string[]} userCategories - The list of allowed categories.
 * @param {string[]} userTypes - The list of allowed types.
 * @param {string[]} softCategories - The list of allowed soft categories.
 * @param {Object[]} variants - The product variants for enhanced classification.
 */
async function classifyCategoryAndTypeWithGemini(enrichedText, productName, userCategories, userTypes, softCategories, variants = []) {
  try {
    // Check if Gemini AI is available
    if (!ai) {
      throw new Error("Google AI client not initialized - API key may be missing");
    }

    // --- THIS IS THE FIX ---
    // Ensure userCategories, userTypes, and softCategories are arrays
    const categoriesArray = Array.isArray(userCategories) ? userCategories : [];
    const typesArray = Array.isArray(userTypes) ? userTypes : [];
    const softCategoriesArray = Array.isArray(softCategories) ? softCategories : [];
    
    const categoryList = categoriesArray.join(", ");
    const typeList = typesArray.join(", ");
    const softCategoryList = softCategoriesArray.join(", ");

    // Prepare variant information for the AI
    let variantInfo = '';
    if (variants && variants.length > 0) {
      const variantDetails = variants.map(v => {
        const details = [];
        if (v.title) details.push(`Title: ${v.title}`);
        if (v.sku) details.push(`SKU: ${v.sku}`);
        if (v.size) details.push(`Size: ${v.size}`);
        if (v.color) details.push(`Color: ${v.color}`);
        if (v.price) details.push(`Price: ${v.price}`);
        if (v.attributes && v.attributes.length > 0) {
          const attrs = v.attributes.map(attr => `${attr.name}: ${attr.option}`).join(', ');
          details.push(`Attributes: ${attrs}`);
        }
        if (v.options && v.options.length > 0) {
          const options = v.options.map(opt => `${opt.name}: ${opt.value}`).join(', ');
          details.push(`Options: ${options}`);
        }
        return details.join(', ');
      }).join('\n');
      
      variantInfo = `\n\nProduct Variants (${variants.length} total):\n${variantDetails}`;
    }

    const messages = [
      {
        role: "user",
        parts: [{
          text: `You are an advanced AI model specialized in e-commerce. Your task is to classify a product based on the details and variant information provided.
You MUST follow these rules strictly:
1.  Choose one or more categories for the product from this EXACT list: [${categoryList}].
2.  The "category" field in your response MUST be an array.
3.  If NO category from the list is a suitable match, you MUST return an empty array for the "category" field.
4.  Choose one or more types for the product from this EXACT list: [${typeList}].
5.  The "type" field in your response MUST be an array.
6.  If NO type from the list is a suitable match, you MUST return an empty array for the "type" field.
7.  Choose one or more soft categories for the product from this EXACT list: [${softCategoryList}].
8.  The "softCategory" field in your response MUST be an array.
9.  If NO soft category from the list is a suitable match, you MUST return an empty array for the "softCategory" field.
10. Use variant information (colors, sizes, attributes, options) to enhance your classification accuracy.
11. If classifying colors in soft categories, analyze ALL available variants to determine available colors.
12. Do NOT invent, create, or suggest new categories, types, or soft categories.

Product Details:
${enrichedText}

Product Name: ${productName}${variantInfo}

Return ONLY a JSON object with three keys: "category", "type", and "softCategory". For example:
{"category": ["יין אדום"], "type": ["כשר"], "softCategory": ["אירועים מיוחדים"]}`
        }]
      }
    ];

    console.log("🔍 Making Gemini API call for product:", productName);
    console.log("🔍 Categories count:", categoriesArray.length);
    console.log("🔍 Types count:", typesArray.length);
    console.log("🔍 Soft Categories count:", softCategoriesArray.length);

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Gemini API call timed out after 30 seconds")), 30000);
    });

    const apiCallPromise = ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: messages,
      config: {
        responseMimeType: "application/json",
        thinkingConfig: {
          thinkingBudget: 0
        }
      },
    });

    const response = await Promise.race([apiCallPromise, timeoutPromise]);

    console.log("✅ Gemini API response received");
    console.log("🔍 Response structure:", JSON.stringify(response, null, 2));

    if (!response) {
      throw new Error("Gemini API returned null/undefined response");
    }

    let resultText;
    if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
        console.log("✅ Using direct candidates structure");
        resultText = response.candidates[0].content.parts[0].text;
    } else if (response.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        console.log("✅ Using legacy response.response structure");
        resultText = response.response.candidates[0].content.parts[0].text;
    }

    if (resultText) {
        const parsed = await parseGeminiResult(resultText);
        if (parsed && parsed.category && !Array.isArray(parsed.category)) {
            parsed.category = [parsed.category];
        }
        return parsed;
    }

    throw new Error("Invalid response structure from Gemini API - no valid candidates found");

  } catch (error) {
    console.error("❌ Gemini classification failed:", error.message);
    console.error("❌ Full error details:", error);
    console.error("❌ Context - Product:", productName);
    console.error("❌ Context - Categories available:", Array.isArray(userCategories) ? userCategories.length : 'not array');
    console.error("❌ Context - Types available:", Array.isArray(userTypes) ? userTypes.length : 'not array');
    console.error("❌ Context - Soft Categories available:", Array.isArray(softCategories) ? softCategories.length : 'not array');
    
    return { category: [], type: [], softCategory: [] };
  }
}

/** Fallback Gemini classification with simplified prompt */
async function classifyCategoryUsingGeminiSimple(translatedDescription, productName, userCategories) {
  try {
    // Check if Gemini AI is available
    if (!ai) {
      console.warn("Google AI client not initialized - no fallback available");
      return { category: [], type: [] };
    }

    const categoryList = userCategories.join(", ");
    
    const messages = [
      {
        role: 'user',
        parts: [{
          text: `From the following list of categories: [${userCategories.join(', ')}], pick the most suitable one for the product: "${productName}".
Description: ${translatedDescription}
Return only a JSON object with a single key "category" containing an array with the single best category name. If none match, return an empty array. Example: {"category": ["The Category"]}`
        }]
      }
    ];

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

    // Handle response structure
    let result;
    if (response.candidates && Array.isArray(response.candidates) && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (candidate && candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
        result = candidate.content.parts[0].text;
      }
    } else if (response.response && response.response.candidates && Array.isArray(response.response.candidates) && response.response.candidates.length > 0) {
      const candidate = response.response.candidates[0];
      if (candidate && candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
        result = candidate.content.parts[0].text;
      }
    }
    
    let category = result?.trim() || "";
    // Final check to ensure the returned category is in the allowed list
    if (!userCategories.includes(category) && category !== "None") {
        category = "None"; // Force to None if the model hallucinates a category
    }
    return { category: category === "None" ? [] : [category], type: [] }; // Types are not handled by this fallback
  } catch (error) {
    console.error(`❌ Fallback Gemini classification failed for "${productName}":`, error);
    return { category: [], type: [] };
  }
}

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

/** Process and normalize variants for WooCommerce products */
function processWooCommerceVariants(product) {
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

    // Extract attributes for WooCommerce
    const allAttributes = variants.flatMap(v => v.attributes || []);
    const sizes = [...new Set(allAttributes.filter(attr => 
      attr.name?.toLowerCase().includes('size')).map(attr => attr.option))].filter(Boolean);
    const colors = [...new Set(allAttributes.filter(attr => 
      attr.name?.toLowerCase().includes('color') || attr.name?.toLowerCase().includes('colour')).map(attr => attr.option))].filter(Boolean);

    return { variants, sizes, colors };
  }

  // No variants - return empty arrays
  return { variants: [], sizes: [], colors: [] };
}

/** Helper function to create basic product data */
function createBasicProductData(product) {
  const variantData = processWooCommerceVariants(product);
  
  return {
    id: product.id,
    name: product.name,
    sku: product.sku || null, // Add SKU support
    description: product.description,
    short_description: product.short_description,
    price: parsePrice(product.price),
    regular_price: parsePrice(product.regular_price),
    sale_price: parsePrice(product.sale_price),
    stock_status: product.stock_status,
    categories: product.categories,
    images: product.images,
    metadata: product.meta_data,
    url: product.permalink || product.link || null,
    image: product.images && product.images.length > 0 ? product.images[0].src : null,
    stockStatus: product.stock_status,
    fetchedAt: new Date(),
    onSale: product.on_sale || false,
    // Add variant data
    variants: variantData.variants,
    sizes: variantData.sizes,
    colors: variantData.colors
  };
}

/** Local category detection */
function updateLocalCategoryTypes(categories, description, userTypes) {
  // Ensure userTypes is an array
  const validUserTypes = Array.isArray(userTypes) ? userTypes : [];
  
  // Ensure categories is an array
  if (!Array.isArray(categories)) return [];
  
  const typeMarkers = [];
  
  for (const cat of categories) {
    if (!cat?.name) continue;
    const name = cat.name;
    
    // Skip if explicitly "לא כשר" or "Not Kosher"
    const isNotKosher = /לא\s*כשר|Not\s*Kosher/.test(name);
    
    if (!isNotKosher && /\bכשר\b|\bKosher\b/.test(name) && validUserTypes.includes("כשר")) {
      typeMarkers.push("כשר");
    }
    
    // Check for "מבצע" (sale) in category names like "2 יינות במבצע"
    if (/2 יינות ב|3 יינות ב|2 Wines B|3 Wines B/.test(name) && validUserTypes.includes("מבצע")) {
      typeMarkers.push("מבצע");
    }
  }
  
  // Also check description for kosher markers
  if (description && /\bכשר\b/.test(description) && !/לא\s*כשר/.test(description) && validUserTypes.includes("כשר")) {
    typeMarkers.push("כשר");
  }
  
  return [...new Set(typeMarkers)]; // Remove duplicates
}

/** 
 * Fetch and process WooCommerce products with enrichment.
 */
async function processWooProducts({ wooUrl, wooKey, wooSecret, userEmail, categories, userTypes, softCategories, dbName }) {
  const logs = [];
  
  // Helper function to add logs and write to DB in real-time
  let statusCol;
  const addLog = async (message) => {
    logs.push(message);
    console.log(message);
    if (statusCol) {
      try {
        await statusCol.updateOne(
          { dbName },
          { $push: { logs: message } },
          { upsert: true }
        );
      } catch (err) {
        console.error("Failed to write log to DB:", err);
      }
    }
  };

  await addLog(`🚀 Starting WooCommerce processing for: ${userEmail}`);
  await addLog(`🔗 WooCommerce URL: ${wooUrl}`);

  // Validate and ensure userTypes is an array
  const validUserTypes = Array.isArray(userTypes) ? userTypes : [];
  await addLog(`🏷️ User types: ${validUserTypes.length > 0 ? validUserTypes.join(', ') : 'none'}`);

  const client = new MongoClient(MONGO_URI, { connectTimeoutMS: 30000, serverSelectionTimeoutMS: 30000 });

  try {
    await client.connect();
    await addLog("✅ Connected to MongoDB");

    const db = client.db(dbName);
    const collection = db.collection("products");
    statusCol = db.collection("sync_status");

    // Initialize status
    await statusCol.updateOne(
      { dbName },
      { 
        $set: { 
          dbName, 
          state: "processing", 
          progress: 0, 
          startedAt: new Date(),
          logs: [] 
        } 
      },
      { upsert: true }
    );

    const api = new WooCommerceRestApi({
      url: wooUrl,
      consumerKey: wooKey,
      consumerSecret: wooSecret,
      version: "wc/v3"
    });

    await addLog("🛍️ Fetching all products from WooCommerce...");
    let allProducts = [];
    let page = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      try {
        const response = await api.get("products", {
          per_page: 100,
          page: page,
          status: 'publish',
          _embed: true // This includes variations and other related data
        });

        await addLog(`🔍 Raw API Response Headers: ${JSON.stringify(response.headers)}`);
        await addLog(`📊 Total WooCommerce Products (from headers): ${response.headers['x-wp-total'] || 'unknown'}`);
        await addLog(`📑 Total Pages (from headers): ${response.headers['x-wp-totalpages'] || 'unknown'}`);

        const products = response.data || [];
        if (products.length === 0) {
          await addLog(`⚠️ Page ${page}: No products found - ending pagination`);
          hasMorePages = false;
          break;
        }

        // Log first product structure to debug
        if (page === 1 && products.length > 0) {
          await addLog(`🔍 First product structure example:`);
          await addLog(JSON.stringify({
            id: products[0].id,
            name: products[0].name,
            status: products[0].status,
            stock_status: products[0].stock_status
          }, null, 2));
        }

        // For each product, fetch variations if it's a variable product
        for (const product of products) {
          if (product.type === 'variable' && product.variations && product.variations.length > 0) {
            try {
              await addLog(`🔧 Fetching ${product.variations.length} variations for: ${product.name}`);
              const variationsResponse = await api.get(`products/${product.id}/variations`, {
                per_page: 100
              });
              product.variations = variationsResponse.data || [];
              await addLog(`✅ Loaded ${product.variations.length} variations for: ${product.name}`);
            } catch (variationError) {
              await addLog(`⚠️ Could not fetch variations for ${product.name}: ${variationError.message}`);
              product.variations = []; // Ensure it's an array
            }
          } else {
            product.variations = []; // Ensure variations is always an array
          }
        }

        allProducts = allProducts.concat(products);
        await addLog(`📄 Fetched page ${page}: ${products.length} products found (Running total: ${allProducts.length})`);

        const totalPages = parseInt(response.headers['x-wp-totalpages'] || '1', 10);
        hasMorePages = page < totalPages;
        page++;
      
      } catch (error) {
        await addLog(`❌ Error fetching page ${page} from WooCommerce: ${error.message}`);
        hasMorePages = false; // Stop fetching on error
      }
    }
    
    await addLog(`🗣️ Modifying 'onbackorder' products to be processed as 'instock'.`);
    let backorderCount = 0;
    allProducts.forEach(p => {
        if (p.stock_status === 'onbackorder') {
            p.stock_status = 'instock'; // Modify for processing and for final save
            backorderCount++;
        }
    });
    if (backorderCount > 0) {
        await addLog(`🔄 Found and converted ${backorderCount} 'onbackorder' products to 'instock'.`);
    }
    
    // Filter to only process in-stock items (which now includes onbackorder items)
    const inStockProducts = allProducts.filter(prod => prod.stock_status === 'instock');
    
    // Check which products already have embeddings in the database
    const productIds = inStockProducts.map(prod => prod.id);
    await addLog(`🔍 MongoDB Query for existing products: { id: { $in: [${productIds.slice(0, 5).join(', ')}...] }, embedding: { $exists: true, $ne: null } }`);
    const existingProducts = await collection.find(
      { 
        id: { $in: productIds },
        embedding: { $exists: true, $ne: null }
      },
      { projection: { id: 1 } }
    ).toArray();
    
    await addLog(`📊 MongoDB existing products sample (first 5): ${JSON.stringify(existingProducts.slice(0, 5))}`);

    const existingProductIds = new Set(existingProducts.map(prod => prod.id));
    const productsToProcess = inStockProducts.filter(prod => !existingProductIds.has(prod.id));
    
    await addLog(`📦 Found ${allProducts.length} total products`);
    await addLog(`🏪 ${inStockProducts.length} are in-stock`);
    await addLog(`✅ ${existingProductIds.size} already have embeddings (will skip)`);
    await addLog(`🔄 ${productsToProcess.length} products need processing`);

    // Save basic data for all in-stock products even if no enrichment is needed
    await addLog(`💾 Saving/updating basic data for all ${inStockProducts.length} in-stock products...`);
    
    for (const product of inStockProducts) {
      try {
        const basicProductData = createBasicProductData(product);
        
        // Log SKU information
        if (basicProductData.sku) {
          await addLog(`📦 Product SKU: ${product.name} - ${basicProductData.sku}`);
        }

        // Update with basic data (won't overwrite existing embeddings)
        await collection.updateOne(
          { id: product.id },
          { 
            $set: basicProductData,
            $setOnInsert: { 
              embedding: null,
              category: [],
              type: [],
              softCategory: [],
              description1: null,
              processedAt: null
            }
          },
          { upsert: true }
        );

      } catch (error) {
        await addLog(`❌ Error saving basic data for ${product.name}: ${error.message}`);
      }
    }
    
    if (productsToProcess.length === 0) {
      await addLog(`✨ All in-stock products already have embeddings - no AI enrichment needed!`);
      
      // Mark as completed
      await statusCol.updateOne(
        { dbName },
        { $set: { state: "done", finishedAt: new Date(), progress: 100 } }
      );
      
      await addLog(`✅ WooCommerce processing complete for: ${userEmail}`);
      await addLog(`📊 Total in-stock products saved: ${inStockProducts.length}`);
      await addLog(`📊 Products enriched with AI: 0 (all already processed)`);
      await addLog("🔐 Closing MongoDB connection");
      
      await client.close();
      console.log("✅ MongoDB connection closed");
      return logs;
    }



    // Step 3: Process products that need enrichment (only in-stock ones without embeddings)
    await addLog(`🔄 Starting to enrich ${productsToProcess.length} products...`);

    for (const product of productsToProcess) {
      try {
        await addLog(`\n🟡 Processing: ${product.name} (ID: ${product.id})`);
        
        const { _id, name, description, categories: productCategories, metadata, onSale } = product;
        
        if (!description || description.trim() === "") {
          await addLog("⚠️ Skipping - no description");
          continue;
        }

        // 1) Clean the original description (remove HTML, extra whitespace, etc.)
        const cleanedDescription = parseHtmlToPlainText(description).trim();
        await addLog("✅ Description cleaned");

        // 2) Summarize metadata
        const metadataAppend = await summarizeMetadata(metadata);
        const categoryAppend = productCategories?.map(c => c.name).join('\n') || '';

        // 3) Create enriched description by appending metadata and categories to original
        const enrichedOriginalDescription = `${cleanedDescription}\n\n${metadataAppend}\n\n${categoryAppend}`.trim();
        await addLog("✅ Metadata and categories appended to original description");

        // 4) Translate the entire enriched description as one piece
        const translatedDescription = await translateDescription(enrichedOriginalDescription);
        if (!translatedDescription) {
          await addLog("⚠️ Skipping - translation of enriched description failed");
          continue;
        }
        await addLog("✅ Complete enriched description translated");

        // 5) Use the translated enriched description for classification and embedding
        const enrichedDescription = translatedDescription;

        // 5) Process variants first to include in classification
        const variantData = processWooCommerceVariants(product);
        await addLog(`🔧 Processing variants for ${name}: ${variantData.variants.length} variants, ${variantData.sizes.length} sizes, ${variantData.colors.length} colors`);

        // 6) Use Gemini/GPT to classify category and type strictly with variant data
        const { category: gptCategory, type: productType, softCategory: productSoftCategory } = await classifyCategoryAndTypeWithGemini(
          enrichedDescription, 
          name, 
          categories, 
          validUserTypes,
          softCategories,
          variantData.variants
        );

        // Debug logging for softCategory
        await addLog(`🔍 Debug - Raw softCategory from Gemini: ${JSON.stringify(productSoftCategory)}`);
        await addLog(`🔍 Debug - softCategories input: ${JSON.stringify(softCategories)}`);

        if (!gptCategory && (!productType || productType.length === 0)) {
          await addLog("⚠️ Warning - no valid category or type found");
        }

        await addLog(`✅ Classification: ${gptCategory || 'None'}, Types: ${productType.join(', ') || 'None'}, Soft Categories: ${Array.isArray(productSoftCategory) ? productSoftCategory.join(', ') : productSoftCategory || 'None'}`);

        // Debug: Log the final type assignment
        const finalType = Array.isArray(productType) ? productType : [];
        const finalSoftCategory = Array.isArray(productSoftCategory) ? productSoftCategory : (productSoftCategory ? [productSoftCategory] : []);
        
        await addLog(`🔍 Debug - Final softCategory for DB: ${JSON.stringify(finalSoftCategory)}`);

        // 6) Generate embeddings
        const embedding = await generateEmbeddings(enrichedDescription);
        if (!embedding) {
          await addLog("⚠️ Warning - embedding generation failed");
        } else {
          await addLog("✅ Embedding generated");
        }

        // 7) Prepare update document with AI enrichment data (variants already processed above)
        const updateDoc = {
          ...createBasicProductData(product),
          description1: enrichedDescription,
          embedding: embedding,
          category: gptCategory || [],
          type: finalType,
          softCategory: finalSoftCategory,
          // Override variants with the processed data from above
          variants: variantData.variants,
          sizes: variantData.sizes,
          colors: variantData.colors,
          processedAt: new Date()
        };

        await addLog(`🔍 Price conversion debug - Original: ${product.price} (${typeof product.price}) -> Parsed: ${updateDoc.price} (${typeof updateDoc.price})`);
        await addLog(`🔍 Regular price debug - Original: ${product.regular_price} (${typeof product.regular_price}) -> Parsed: ${updateDoc.regular_price} (${typeof updateDoc.regular_price})`);
        await addLog(`🔍 Sale price debug - Original: ${product.sale_price} (${typeof product.sale_price}) -> Parsed: ${updateDoc.sale_price} (${typeof updateDoc.sale_price})`);
        
        // Validate that all prices are numbers
        const priceFields = ['price', 'regular_price', 'sale_price'];
        const invalidPrices = priceFields.filter(field => typeof updateDoc[field] !== 'number');
        if (invalidPrices.length > 0) {
          await addLog(`❌ WARNING: Non-numeric prices detected: ${invalidPrices.join(', ')}`);
        } else {
          await addLog(`✅ All price fields are properly converted to numbers`);
        }

        await addLog(`🔍 Updating MongoDB document for product ${product.id}:`);
        await addLog(`Query: { _id: ${_id} }`);
        await addLog(`Update: $set with fields: ${Object.keys(updateDoc).join(', ')}`);
    
        const updateResult = await collection.updateOne(
          { id: product.id }, // Changed from _id to id for consistency
          { $set: updateDoc },
          { upsert: true } // Added upsert option
        );
        
        await addLog(`📝 MongoDB update result: ${JSON.stringify({
          matched: updateResult.matchedCount,
          modified: updateResult.modifiedCount,
          upserted: updateResult.upsertedCount
        })}`);
        await addLog(`💾 Updated product: ${name}`);

      } catch (error) {
        const errMsg = `❌ Error processing ${product.name}: ${error.message}`;
        await addLog(errMsg);
        console.error("Full error:", error);
      }
    }
    
    // Mark as completed
    await statusCol.updateOne(
      { dbName },
      { $set: { state: "done", finishedAt: new Date(), progress: 100 } }
    );
    
    // Before closing, check final collection state
    const finalCount = await collection.countDocuments({});
    await addLog(`📊 Final collection count: ${finalCount} documents`);
    const processedCount = await collection.countDocuments({ processedAt: { $exists: true } });
    await addLog(`📊 Processed documents count: ${processedCount}`);
    const withEmbeddings = await collection.countDocuments({ embedding: { $exists: true } });
    await addLog(`📊 Documents with embeddings: ${withEmbeddings}`);
    
    await addLog(`✅ WooCommerce processing complete for: ${userEmail}`);
    await addLog(`📊 Total in-stock products saved: ${inStockProducts.length}`);
    await addLog(`📊 Products enriched with AI: ${productsToProcess.length}`);
    await addLog("🔐 Closing MongoDB connection");
    
    await client.close();
    console.log("✅ MongoDB connection closed");
    return logs;

  } catch (err) {
    await addLog(`❌ MongoDB connection failed: ${err.message}`);
    return logs;
  }
}

module.exports = {
  processWooProducts,
  classifyCategoryAndTypeWithGemini,
  summarizeMetadata
};
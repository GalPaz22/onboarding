import express from 'express';
import clientPromise from '../lib/mongodb.js';
import processShopify from '../lib/processShopify.js';
import { processWooProducts } from '../lib/processWoo.js';
import processWooImages from '../lib/processWooImages.js';
import processShopifyImages from '../lib/processShopifyImages.js';
import { setJobState } from '../lib/syncStatus.js';

const router = express.Router();

/* ---------- credential validation helpers ----------------------- */
async function validateShopifyCredentials(domain, token) {
  try {
    if (!domain || !token) {
      console.error('Missing Shopify credentials:', { domain: !!domain, token: !!token });
      return false;
    }

    // Remove any protocol and trailing slashes, ensure .myshopify.com is present
    let cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!cleanDomain.includes('.myshopify.com')) {
      cleanDomain = `${cleanDomain}.myshopify.com`;
    }

    // Validate domain format
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(cleanDomain)) {
      console.error('Invalid Shopify domain format:', cleanDomain);
      return false;
    }

    console.log('Attempting to validate Shopify credentials:', { cleanDomain });
    const url = `https://${cleanDomain}/admin/api/2023-10/shop.json`;
    
    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
        'User-Agent': 'Semantix/1.0'
      },
      // Add SSL/TLS configuration
      cache: 'no-store'
    });
    
    if (!response.ok) {
      console.error('Shopify validation failed:', {
        status: response.status,
        statusText: response.statusText,
        domain: cleanDomain
      });
      try {
        const responseText = await response.text();
        console.error('Shopify error response:', responseText.substring(0, 200));
        // Try to parse as JSON if possible
        try {
          const errorData = JSON.parse(responseText);
          console.error('Shopify error details:', errorData);
        } catch (jsonError) {
          console.error('Response is not JSON, likely HTML error page');
        }
      } catch (e) {
        console.error('Could not read error response:', e.message);
      }
      return false;
    }
    
    // For successful responses, validate JSON content
    try {
      const responseText = await response.text();
      const shopData = JSON.parse(responseText);
      console.log('Shopify validation successful:', shopData.shop?.name || 'Shop name not found');
      return true;
    } catch (jsonError) {
      console.error('Shopify returned invalid JSON:', {
        error: jsonError.message,
        domain: cleanDomain
      });
      return false;
    }
    
    return response.ok;
  } catch (error) {
    console.error('Shopify validation error:', {
      error: error.message,
      domain,
      stack: error.stack,
      cause: error.cause
    });
    return false;
  }
}

async function validateWooCredentials(wooUrl, wooKey, wooSecret) {
  try {
    const cleanUrl = wooUrl.replace(/\/$/, '');
    const url = `${cleanUrl}/wp-json/wc/v3/system_status`;
    
    const auth = Buffer.from(`${wooKey}:${wooSecret}`).toString('base64');
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    });
    
    return response.ok;
  } catch (error) {
    console.error('WooCommerce validation error:', error);
    return false;
  }
}

/* ---------- little helper – write state to Mongo ------------------- */
async function createProductIndexes(client, dbName) {
  const collectionName = "products";
  const db = client.db(dbName);

  try {
    const collection = db.collection(collectionName);
    
    // Create compound indexes for efficient querying
    const indexes = [
      // Index for category filtering
      { category: 1, fetchedAt: -1 },
      // Index for type filtering (since type can be an array)
      { type: 1, fetchedAt: -1 },
      // Index for softCategory filtering (since softCategory can be an array)
      { softCategory: 1, fetchedAt: -1 },
      // Index for stock status filtering
      { stockStatus: 1, fetchedAt: -1 },
      // Index for processed/pending status filtering
      { description1: 1, fetchedAt: -1 },
      // Text index for search functionality
      { name: "text", description1: "text" },
      // Compound index for common filter combinations
      { category: 1, stockStatus: 1, fetchedAt: -1 },
      { softCategory: 1, stockStatus: 1, fetchedAt: -1 }
    ];

    // Create each index
    for (const indexSpec of indexes) {
      try {
        await collection.createIndex(indexSpec);
        console.log(`Created index:`, indexSpec);
      } catch (error) {
        // Index might already exist, which is fine
        if (error.code !== 85) { // Not IndexAlreadyExists
          console.warn(`Warning creating index ${JSON.stringify(indexSpec)}:`, error.message);
        }
      }
    }

    console.log("Product indexes created successfully");
    return { acknowledged: true };
  } catch (error) {
    console.error("Error creating product indexes:", error);
    // Don't fail the onboarding process for index creation errors
    return { acknowledged: false, error: error.message };
  }
}

async function createEmbeddingIndex(client, dbName) {
  const collectionName = "products";
  const db = client.db(dbName);

  // Check if collection exists; if not, create it.
  const collections = await db.listCollections({ name: collectionName }).toArray();
  if (!collections.length) {
    await db.createCollection(collectionName);
    console.log(`Collection '${collectionName}' did not exist and was created.`);
  }

  // Check if the vector_index already exists
  try {
    const existingIndexes = await db.collection(collectionName).listSearchIndexes().toArray();
    const vectorIndexExists = existingIndexes.some(index => index.name === "vector_index");
    
    if (vectorIndexExists) {
      console.log("Vector index 'vector_index' already exists, skipping creation.");
      return { acknowledged: true, message: "Index already exists" };
    }
  } catch (error) {
    // If listSearchIndexes fails, we'll try to create the index anyway
    console.log("Could not check existing indexes, proceeding with creation:", error.message);
  }

  const indexConfig = {
    name: "vector_index",
    type: "vectorSearch",
    definition: {
      fields: [
        {
          numDimensions: 3072,
          path: "embedding",
          similarity: "cosine",
          type: "vector"
        },
        {
          path: "category",
          type: "filter"
        },
        {
          path: "price",
          type: "filter"
        },
        {
          path: "type",
          type: "filter"
        },
        {
          path: "softCategory",
          type: "filter"
        }
      ]
    }
  };

  try {
    // Use the createSearchIndex method to create the vector search index.
    const result = await db.collection(collectionName).createSearchIndex(indexConfig);
    console.log("Embedding search index created:", result);
    return result;
  } catch (error) {
    // Handle the specific case where the index already exists
    if (error.code === 68 && error.codeName === 'IndexAlreadyExists') {
      console.log("Vector index already exists, continuing...");
      return { acknowledged: true, message: "Index already exists" };
    }
    // Re-throw other errors
    throw error;
  }
}

async function createAutocompleteIndex(client, dbName) {
  const collectionName = "products";
  const db = client.db(dbName);

  // Ensure the "products" collection exists; if not, create it.
  const collections = await db.listCollections({ name: collectionName }).toArray();
  if (!collections.length) {
    await db.createCollection(collectionName);
    console.log(`Collection '${collectionName}' was created.`);
  }

  // Check if the default index already exists
  try {
    const existingIndexes = await db.collection(collectionName).listSearchIndexes().toArray();
    const defaultIndexExists = existingIndexes.some(index => index.name === "default");
    
    if (defaultIndexExists) {
      console.log("Autocomplete index 'default' already exists, skipping creation.");
      return { acknowledged: true, message: "Index already exists" };
    }
  } catch (error) {
    // If listSearchIndexes fails, we'll try to create the index anyway
    console.log("Could not check existing indexes, proceeding with creation:", error.message);
  }

  // Define the new autocomplete search index configuration.
  const autocompleteIndexConfig = {
    name: "default",
    definition: {
      mappings: {
        dynamic: true,
        fields: {
          description: [
            {
              maxGrams: 20,
              minGrams: 2,
              tokenization: "edgeGram",
              type: "autocomplete"
            },
            {
              analyzer: "lucene.standard",
              type: "string"
            }
          ],
          name: [
            {
              maxGrams: 20,
              minGrams: 2,
              tokenization: "edgeGram",
              type: "autocomplete"
            },
            {
              analyzer: "lucene.standard",
              type: "string"
            }
          ]
        }
      }
    }
  };

  try {
    // Use the createSearchIndexes command to create the Atlas Search index.
    const result = await db.command({
      createSearchIndexes: collectionName,
      indexes: [autocompleteIndexConfig]
    });
    console.log("Autocomplete search index created:", result);
    return result;
  } catch (error) {
    // Handle the specific case where the index already exists
    if (error.code === 68 && error.codeName === 'IndexAlreadyExists') {
      console.log("Autocomplete index already exists, continuing...");
      return { acknowledged: true, message: "Index already exists" };
    }
    // Re-throw other errors
    throw error;
  }
}

/* ------------------------------------------------------------------ */
router.post('/', async (req, res) => {
  try {
    /* 1)  Extract user email from request body (required) */
    const {
      platform,
      shopifyDomain,
      shopifyToken,
      wooUrl,
      wooKey,
      wooSecret,
      dbName,
      categories,
      syncMode,
      type, 
      context,
      explain,
      softCategories,
      userEmail
      // "text" | "image"
    } = req.body;

    // Validate required fields
    if (!dbName) {
      return res.status(400).json({ error: "missing dbName" });
    }

    if (!userEmail) {
      return res.status(400).json({ error: "missing userEmail" });
    }

    // Debug logging for type parameter
    console.log("🔍 [Onboarding API] Received parameters:");
    console.log("🔍 [Onboarding API] platform:", platform);
    console.log("🔍 [Onboarding API] dbName:", dbName);
    console.log("🔍 [Onboarding API] categories:", categories);
    console.log("🔍 [Onboarding API] type:", type);
    console.log("🔍 [Onboarding API] type is array:", Array.isArray(type));
    console.log("🔍 [Onboarding API] type length:", Array.isArray(type) ? type.length : 'not array');
    console.log("🔍 [Onboarding API] syncMode:", syncMode);
    console.log("🔍 [Onboarding API] softCategories:", softCategories);
    console.log("🔍 [Onboarding API] userEmail:", userEmail);

    /* 3) Validate platform credentials before proceeding */
    let isValidCredentials = false;
    
    if (platform === "shopify") {
      if (!shopifyDomain || !shopifyToken) {
        return res.status(401).json({ 
          error: "Invalid credentials", 
          message: "Shopify domain and access token are required" 
        });
      }
      isValidCredentials = await validateShopifyCredentials(shopifyDomain, shopifyToken);
    } else if (platform === "woocommerce") {
      if (!wooUrl || !wooKey || !wooSecret) {
        return res.status(401).json({ 
          error: "Invalid credentials", 
          message: "WooCommerce URL, consumer key, and consumer secret are required" 
        });
      }
      isValidCredentials = await validateWooCredentials(wooUrl, wooKey, wooSecret);
    } else {
      return res.status(400).json({ 
        error: "Invalid platform", 
        message: "Platform must be either 'shopify' or 'woocommerce'" 
      });
    }

    if (!isValidCredentials) {
      return res.status(401).json({ 
        error: "Invalid credentials", 
        message: platform === "shopify" 
          ? "Unable to connect to Shopify. Please check your domain and access token." 
          : "Unable to connect to WooCommerce. Please check your URL, consumer key, and consumer secret."
      });
    }

    /* 4)  persist the credentials  */
    const client = await clientPromise;
    const users = client.db("users").collection("users");

    // Check if the user already has a record in the database
    const existingUser = await users.findOne({ email: userEmail });
    const isFirstTimeOnboarding = !existingUser?.onboardingComplete;

    // Remove platform from credentials.
    const credentials =
      platform === "shopify"
        ? { shopifyDomain, shopifyToken, categories, dbName, type, softCategories }
        : { wooUrl, wooKey, wooSecret, categories, dbName, type, softCategories };

    // Update the user record with credentials and trial information
    const updateData = {
      credentials,
      onboardingComplete: true,
      dbName,
      platform,
      syncMode,
      context,
      explain: explain ?? false,
      updatedAt: new Date()
    };

    // Only set trialStartedAt if this is the first time onboarding
    if (isFirstTimeOnboarding) {
      updateData.trialStartedAt = new Date();
      updateData.trialStatus = 'active';
    }

    // Update the user so that the platform is saved as a top-level field
    await users.updateOne(
      { email: userEmail },
      { $set: updateData },
      { upsert: true }
    );

    await createEmbeddingIndex(client, dbName);
    await createAutocompleteIndex(client, dbName);
    await createProductIndexes(client, dbName);

    /* 5)  mark job=running and launch the heavy lift in background  */
    await setJobState(dbName, "running");

    // Process sync synchronously with timeout protection
    let logs = [];
    try {
      console.log("🔍 [Onboarding API] Starting sync processing with:");
      console.log("🔍 [Onboarding API] Final type parameter:", type);
      console.log("🔍 [Onboarding API] Final categories parameter:", categories);
      
      if (platform === "woocommerce") {
        console.log("🔍 [Onboarding API] Calling WooCommerce processing...");
        if (syncMode === "image") {
          console.log("🔍 [Onboarding API] processWooImages parameters:", { wooUrl: !!wooUrl, wooKey: !!wooKey, wooSecret: !!wooSecret, userEmail, categories, type, softCategories, dbName });
          logs = await processWooImages({ wooUrl, wooKey, wooSecret, userEmail, categories, userTypes: type, softCategories, dbName });
        } else {
          console.log("🔍 [Onboarding API] processWooProducts parameters:", { wooUrl: !!wooUrl, wooKey: !!wooKey, wooSecret: !!wooSecret, userEmail, categories, type, softCategories, dbName });
          logs = await processWooProducts({ wooUrl, wooKey, wooSecret, userEmail, categories, userTypes: type, softCategories, dbName });
        }
      } else if (platform === "shopify") {
        console.log("🔍 [Onboarding API] Calling Shopify processing...");
        if (syncMode === "image") {
          console.log("🔍 [Onboarding API] processShopifyImages parameters:", { shopifyDomain: !!shopifyDomain, shopifyToken: !!shopifyToken, dbName, categories, type, softCategories, context });
          logs = await processShopifyImages({ shopifyDomain, shopifyToken, dbName, categories, userTypes: type, softCategories, context });
        } else {
          console.log("🔍 [Onboarding API] processShopify parameters:", { shopifyDomain: !!shopifyDomain, shopifyToken: !!shopifyToken, dbName, categories, type, softCategories });
          logs = await processShopify({ shopifyDomain, shopifyToken, dbName, categories, userTypes: type, softCategories });
        }
      }
       await setJobState(dbName, "done");

       // Log the collected messages from the sync process.
       console.log("Sync logs:", logs);
       
       return res.status(200).json({ 
         success: true, 
         state: "done",
         isNewTrial: isFirstTimeOnboarding,
         logs: logs
       });
       
     } catch (err) {
       console.error("sync error", err);
       await setJobState(dbName, "error");
       
       return res.status(500).json({ 
         success: false, 
         error: err.message,
         state: "error"
       });
     }
  } catch (err) {
    console.error("[onboarding error]", err);
    return res.status(500).json({ error: "Something went wrong" });
  }
});

/* ------------------------------------------------------------------ */
/* BONUS: tiny GET endpoint so the dashboard can poll job status      */
/* /api/onboarding/status?dbName=myStore                              */
router.get('/status', async (req, res) => {
  const { dbName } = req.query;

  if (!dbName) {
    return res.status(400).json({ error: "dbName is required" });
  }

  try {
    const client = await clientPromise;
    const db = client.db(dbName);
    const statusCol = db.collection("sync_status");

    const status = await statusCol.findOne({ dbName });
    return res.json({ 
      state: status?.state || "idle", 
      progress: status?.progress || 0,
      done: status?.done || 0,
      total: status?.total || 0
    });
  } catch (err) {
    console.error("GET /api/onboarding/status error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

export default router;
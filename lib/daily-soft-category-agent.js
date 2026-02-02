import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import reprocessProducts from "./reprocess-products.js";
import { callGeminiJSON, isAIAvailable } from "./llm-utils.js";

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI;

/**
 * Analyze potential soft categories using LLM to select the best terms
 * @param {Object} potentialCategories - Object with category terms and their metadata
 * @param {Array} existingSoftCategories - Array of currently active soft categories
 * @param {number} maxTerms - Maximum number of terms to select (default: 5)
 * @returns {Array} - Array of selected terms
 */
async function analyzePotentialCategories(potentialCategories, existingSoftCategories, maxTerms = 5) {
  if (!isAIAvailable()) {
    console.warn('⚠️ Google AI not available - falling back to simple scoring');
    return fallbackCategorySelection(potentialCategories, existingSoftCategories, maxTerms);
  }

  try {
    // Prepare category data with scores
    const categoryData = Object.entries(potentialCategories).map(([term, data]) => ({
      term,
      count: data.count || 0,
      firstSeen: data.firstSeen || new Date().toISOString(),
      lastSeen: data.lastSeen || new Date().toISOString(),
      exampleQueries: data.exampleQueries || []
    }));

    // Build the prompt for LLM
    const prompt = `You are an intelligent e-commerce soft category analyzer. Your task is to select the best ${maxTerms} terms to add as new soft categories for product classification.

Current Soft Categories (${existingSoftCategories.length} total):
${existingSoftCategories.join(', ')}

Potential New Categories to evaluate:
${JSON.stringify(categoryData, null, 2)}

Selection Criteria:
1. **High Usage Frequency**: Terms with higher 'count' are more valuable
2. **Recent Activity**: Terms with recent 'lastSeen' dates show current relevance
3. **Search Intent**: Terms from 'exampleQueries' that show clear user intent
4. **Uniqueness**: Avoid terms that are synonyms or too similar to existing soft categories
5. **Clarity**: Prefer specific, actionable terms over vague ones
6. **Business Value**: Terms that help users find products effectively

Rules:
- Select EXACTLY ${maxTerms} terms (or fewer if not enough quality candidates)
- EXCLUDE any term already in the current soft categories list
- Prioritize terms that are distinct and add unique value
- Consider Hebrew/English variations (don't duplicate same concept)
- Return ONLY the selected terms as a JSON array of strings

Return format:
{"selectedTerms": ["term1", "term2", "term3", "term4", "term5"]}`;

    const messages = [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ];

    console.log('🤖 Analyzing potential categories with Gemini 2.5 Flash...');

    // Use shared LLM utility with consistent Gemini 2.5 Flash configuration
    const parsed = await callGeminiJSON(messages);
    const selectedTerms = parsed.selectedTerms || [];

    console.log(`✅ LLM selected ${selectedTerms.length} terms:`, selectedTerms);
    return selectedTerms;

  } catch (error) {
    console.error('❌ Error analyzing categories with LLM:', error.message);
    return fallbackCategorySelection(potentialCategories, existingSoftCategories, maxTerms);
  }
}

/**
 * Fallback category selection using simple scoring algorithm
 * @param {Object} potentialCategories - Object with category terms and their metadata
 * @param {Array} existingSoftCategories - Array of currently active soft categories
 * @param {number} maxTerms - Maximum number of terms to select
 * @returns {Array} - Array of selected terms
 */
function fallbackCategorySelection(potentialCategories, existingSoftCategories, maxTerms = 5) {
  console.log('📊 Using fallback scoring algorithm');

  const now = new Date();
  const scored = Object.entries(potentialCategories).map(([term, data]) => {
    // Skip if already in existing soft categories
    if (existingSoftCategories.includes(term)) {
      return null;
    }

    const count = data.count || 0;
    const lastSeen = data.lastSeen ? new Date(data.lastSeen) : now;
    const firstSeen = data.firstSeen ? new Date(data.firstSeen) : now;

    // Calculate recency score (more recent = higher score)
    const daysSinceLastSeen = (now - lastSeen) / (1000 * 60 * 60 * 24);
    const recencyScore = Math.max(0, 100 - daysSinceLastSeen);

    // Calculate persistence score (longer history = higher score)
    const daysActive = (lastSeen - firstSeen) / (1000 * 60 * 60 * 24);
    const persistenceScore = Math.min(100, daysActive * 2);

    // Combined score: count (50%) + recency (30%) + persistence (20%)
    const totalScore = (count * 0.5) + (recencyScore * 0.3) + (persistenceScore * 0.2);

    return {
      term,
      count,
      lastSeen,
      firstSeen,
      recencyScore,
      persistenceScore,
      totalScore
    };
  })
  .filter(item => item !== null)
  .sort((a, b) => b.totalScore - a.totalScore)
  .slice(0, maxTerms);

  const selectedTerms = scored.map(item => item.term);
  console.log(`✅ Fallback selected ${selectedTerms.length} terms:`, selectedTerms);

  // Log scoring details
  scored.forEach(item => {
    console.log(`   - "${item.term}": score=${item.totalScore.toFixed(2)} (count=${item.count}, recency=${item.recencyScore.toFixed(1)}, persistence=${item.persistenceScore.toFixed(1)})`);
  });

  return selectedTerms;
}

/**
 * Process a single user - analyze potential categories and trigger incremental reprocessing
 * @param {Object} user - User document from MongoDB
 * @returns {Object} - Result object with status and details
 */
async function processSingleUser(user) {
  const { dbName, email, credentials } = user;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`👤 Processing user: ${email || dbName}`);
  console.log(`   Database: ${dbName}`);

  if (!credentials?.potentialSoftCategories) {
    console.log('   ⚠️ No potentialSoftCategories found - skipping');
    return { status: 'skipped', reason: 'no_potential_categories' };
  }

  const potentialCategories = credentials.potentialSoftCategories;
  const existingSoftCategories = credentials.softCategories || [];
  const categories = credentials.categories || [];
  const types = credentials.type || [];

  console.log(`   Current soft categories: ${existingSoftCategories.length}`);
  console.log(`   Potential categories: ${Object.keys(potentialCategories).length}`);

  // Filter out terms already in soft categories
  const filteredPotential = {};
  Object.entries(potentialCategories).forEach(([term, data]) => {
    if (!existingSoftCategories.includes(term)) {
      filteredPotential[term] = data;
    }
  });

  const newTermsAvailable = Object.keys(filteredPotential).length;
  console.log(`   New terms available (not in current): ${newTermsAvailable}`);

  if (newTermsAvailable === 0) {
    console.log('   ✅ No new terms to add - all potential categories already exist');
    return { status: 'skipped', reason: 'no_new_terms' };
  }

  // Analyze and select best terms
  const selectedTerms = await analyzePotentialCategories(
    filteredPotential,
    existingSoftCategories,
    5
  );

  if (selectedTerms.length === 0) {
    console.log('   ⚠️ No suitable terms selected by analyzer');
    return { status: 'skipped', reason: 'no_suitable_terms' };
  }

  console.log(`   ✅ Selected ${selectedTerms.length} new terms to add:`, selectedTerms);

  // Trigger incremental reprocessing
  try {
    console.log('   🔄 Triggering incremental reprocessing...');

    const payload = {
      dbName,
      categories,
      userTypes: types,
      softCategories: [...existingSoftCategories, ...selectedTerms],
      incrementalMode: true,
      incrementalSoftCategories: selectedTerms,
      options: {
        reprocessHardCategories: false,
        reprocessSoftCategories: true,
        reprocessTypes: false,
        reprocessVariants: false,
        reprocessEmbeddings: false,
        reprocessDescriptions: false,
        reprocessAll: false
      }
    };

    // Run in background - don't await
    reprocessProducts(payload).catch(err => {
      console.error(`❌ Background reprocessing failed for ${dbName}:`, err.message);
    });

    console.log('   ✅ Incremental reprocessing started in background');

    return {
      status: 'success',
      dbName,
      email: email || dbName,
      selectedTerms,
      previousCount: existingSoftCategories.length,
      newCount: existingSoftCategories.length + selectedTerms.length
    };

  } catch (error) {
    console.error(`   ❌ Error triggering reprocessing:`, error.message);
    return {
      status: 'error',
      dbName,
      error: error.message
    };
  }
}

/**
 * Main function - iterate through all users and process potential soft categories
 */
async function runDailySoftCategoryAgent() {
  const startTime = Date.now();
  console.log('\n' + '='.repeat(80));
  console.log('🤖 DAILY SOFT CATEGORY AGENT STARTED');
  console.log('   Time:', new Date().toISOString());
  console.log('='.repeat(80));

  if (!isAIAvailable()) {
    console.error('❌ Cannot run agent - Google AI not configured');
    console.log('='.repeat(80) + '\n');
    return;
  }

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
    console.log('✅ Connected to MongoDB');

    const usersDb = client.db('users');
    const usersCollection = usersDb.collection('users');

    // Find all users with potentialSoftCategories
    const query = {
      'credentials.potentialSoftCategories': { $exists: true }
    };

    const users = await usersCollection.find(query).toArray();
    console.log(`📊 Found ${users.length} users with potentialSoftCategories\n`);

    if (users.length === 0) {
      console.log('✅ No users to process');
      return;
    }

    // Process each user
    const results = [];
    for (const user of users) {
      const result = await processSingleUser(user);
      results.push(result);

      // Add delay between users to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n' + '='.repeat(80));
    console.log('🎉 DAILY SOFT CATEGORY AGENT COMPLETED');
    console.log(`   Duration: ${duration}s`);
    console.log(`   Total users processed: ${users.length}`);
    console.log(`   Successful: ${results.filter(r => r.status === 'success').length}`);
    console.log(`   Skipped: ${results.filter(r => r.status === 'skipped').length}`);
    console.log(`   Errors: ${results.filter(r => r.status === 'error').length}`);

    // Log successful updates
    const successful = results.filter(r => r.status === 'success');
    if (successful.length > 0) {
      console.log('\n✅ Successfully updated users:');
      successful.forEach(r => {
        console.log(`   - ${r.email}: Added ${r.selectedTerms.length} terms (${r.previousCount} → ${r.newCount})`);
        console.log(`     New terms: ${r.selectedTerms.join(', ')}`);
      });
    }

    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.error('❌ Fatal error in daily agent:', error);
    throw error;
  } finally {
    await client.close();
    console.log('✅ Closed MongoDB connection');
  }
}

// Export for use in other modules
export default runDailySoftCategoryAgent;

// If called directly from command line, run the agent
if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  runDailySoftCategoryAgent()
    .then(() => {
      console.log('✅ Agent completed successfully');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Agent failed:', err);
      process.exit(1);
    });
}

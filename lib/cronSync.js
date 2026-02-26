import cron from 'node-cron';
import clientPromise from './mongodb.js';
import processShopify from './processShopify.js';
import { processWooProducts } from './processWoo.js';
import { setJobState } from './syncStatus.js';

// ─────────────────────────────────────────────
// Run a full sync for a single user document
// ─────────────────────────────────────────────
async function syncUser(user) {
  const { email, dbName, platform, credentials } = user;

  if (!dbName || !platform || !credentials) {
    console.warn(`[CRON SYNC] ⚠️  Skipping ${email} — missing dbName, platform, or credentials`);
    return;
  }

  console.log(`[CRON SYNC] 🔄 Starting sync for ${email} | db: ${dbName} | platform: ${platform}`);

  try {
    await setJobState(dbName, 'running');

    if (platform === 'shopify') {
      const { shopifyDomain, shopifyToken, categories, type, softCategories } = credentials;
      if (!shopifyDomain || !shopifyToken) {
        throw new Error('Missing Shopify credentials');
      }
      await processShopify({
        shopifyDomain,
        shopifyToken,
        dbName,
        categories: categories || [],
        userTypes: type || [],
        softCategories: softCategories || []
      });

    } else if (platform === 'woocommerce') {
      const { wooUrl, wooKey, wooSecret, categories, type, softCategories } = credentials;
      if (!wooUrl || !wooKey || !wooSecret) {
        throw new Error('Missing WooCommerce credentials');
      }
      await processWooProducts({
        wooUrl,
        wooKey,
        wooSecret,
        userEmail: email,
        dbName,
        categories: categories || [],
        userTypes: type || [],
        softCategories: softCategories || []
      });

    } else {
      throw new Error(`Unknown platform: ${platform}`);
    }

    await setJobState(dbName, 'done');
    console.log(`[CRON SYNC] ✅ Done for ${email}`);

  } catch (err) {
    await setJobState(dbName, 'error').catch(() => {});
    console.error(`[CRON SYNC] ❌ Failed for ${email}:`, err.message);
  }
}

// ─────────────────────────────────────────────
// Iterate all active users and sync each one
// ─────────────────────────────────────────────
async function runScheduledSync() {
  console.log('\n' + '='.repeat(60));
  console.log(`[CRON SYNC] 🕐 Scheduled sync started at ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  try {
    const client = await clientPromise;
    const usersCollection = client.db('users').collection('users');

    const activeUsers = await usersCollection.find({ active: true }).toArray();

    console.log(`[CRON SYNC] Found ${activeUsers.length} active user(s)`);

    if (!activeUsers.length) {
      console.log('[CRON SYNC] No active users to sync.');
      return;
    }

    // Run sequentially to avoid overwhelming the DB / external APIs
    for (const user of activeUsers) {
      await syncUser(user);
    }

    console.log(`[CRON SYNC] ✅ All active users synced at ${new Date().toISOString()}`);

  } catch (err) {
    console.error('[CRON SYNC] ❌ Fatal error during scheduled sync:', err.message);
  }

  console.log('='.repeat(60) + '\n');
}

// ─────────────────────────────────────────────
// Schedule: 06:00 AM and 06:00 PM (server time)
// ─────────────────────────────────────────────
export function startCronSync() {
  // "0 6,18 * * *" → at minute 0 of hour 6 and 18, every day
  cron.schedule('0 6,18 * * *', runScheduledSync, {
    timezone: 'UTC'
  });

  console.log('[CRON SYNC] ⏰ Scheduled sync registered — runs daily at 06:00 and 18:00 UTC');
}

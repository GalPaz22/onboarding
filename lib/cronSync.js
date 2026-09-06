import cron from 'node-cron';
import clientPromise from './mongodb.js';
import processShopify from './processShopify.js';
import { processWooProducts } from './processWoo.js';
import { setJobState } from './syncStatus.js';

// ─────────────────────────────────────────────
// Run a full sync for a single user document
// ─────────────────────────────────────────────
async function syncUser(user) {
  const { email } = user;

  // Resolve credentials/configuration from all possible locations,
  // mirroring semantix-front-hebrew's admin sync-products route.
  const credentials = user.credentials || user.onboarding?.credentials || {};
  const configuration = user.configuration || {};

  const platform = user.platform || credentials.platform || configuration.platform;
  const dbName = credentials.dbName || configuration.dbName || user.onboarding?.dbName || user.dbName;

  const categories = configuration.categories?.list || credentials.categories || [];
  const userTypes = configuration.types?.list || credentials.type || [];
  const softCategories = configuration.softCategories?.list || credentials.softCategories || [];
  const colors = configuration.colors?.list || credentials.colors || [];

  if (!dbName || !platform) {
    console.warn(`[CRON SYNC] ⚠️  Skipping ${email} — missing dbName or platform`);
    return;
  }

  console.log(`[CRON SYNC] 🔄 Starting sync for ${email} | db: ${dbName} | platform: ${platform}`);

  try {
    await setJobState(dbName, 'running');

    if (platform === 'shopify') {
      const { shopifyDomain, shopifyToken, shopifyClientId, shopifyClientSecret } = credentials;
      if (!shopifyDomain) {
        throw new Error('Missing Shopify domain');
      }
      // Prefer 2026 client-credentials flow; fall back to legacy token,
      // then to the public products.json fetch inside the processor.
      const shopifyAuthArgs = shopifyClientId && shopifyClientSecret
        ? { shopifyDomain, shopifyClientId, shopifyClientSecret }
        : { shopifyDomain, ...(shopifyToken ? { shopifyToken } : {}) };

      await processShopify({
        ...shopifyAuthArgs,
        dbName,
        categories,
        type: userTypes,
        softCategories,
        colors
      });

    } else if (platform === 'woocommerce') {
      const { wooUrl, wooKey, wooSecret } = credentials;
      if (!wooUrl) {
        throw new Error('Missing WooCommerce URL');
      }
      // wooKey/wooSecret optional — processor falls back to the public
      // /wp-json/wp/v2/product endpoint when they're absent.
      await processWooProducts({
        wooUrl,
        wooKey,
        wooSecret,
        userEmail: email,
        dbName,
        categories,
        userTypes,
        softCategories,
        colors
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
// Schedule: every 5 minutes
// ─────────────────────────────────────────────
export function startCronSync() {
  // "*/5 * * * *" → at every 5th minute
  cron.schedule('*/5 * * * *', runScheduledSync, {
    timezone: 'UTC'
  });

  console.log('[CRON SYNC] ⏰ Scheduled sync registered — runs every 5 minutes');
}

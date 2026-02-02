import express from 'express';
import reprocessProducts from '../lib/reprocess-products.js';
import { setJobState } from '../lib/syncStatus.js';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    console.log('📊 [REPROCESS] Checking authenticated user data:');
    console.log('   req.user exists:', !!req.user);
    console.log('   req.user:', req.user ? 'present' : 'MISSING');
    
    // Get user data from authenticated request
    const userEmail = req.user?.email;
    const dbName = req.user?.dbName;
    const storedCategories = req.user?.credentials?.categories || [];
    const storedTypes = req.user?.credentials?.type || [];
    const storedSoftCategories = req.user?.credentials?.softCategories || [];
    
    console.log('📊 [REPROCESS] Extracted values:');
    console.log('   userEmail:', userEmail || 'MISSING');
    console.log('   dbName from req.user:', dbName || 'MISSING');
    console.log('   platform:', req.user?.platform || 'MISSING');
    console.log('   credentials present:', !!req.user?.credentials);
    
    if (!dbName) {
      console.log('❌ [REPROCESS] ERROR: dbName is missing from authenticated user!');
      console.log('   Full req.user:', JSON.stringify(req.user, null, 2));
      return res.status(400).json({ 
        error: "missing dbName",
        details: "User record does not have dbName. Please re-onboard."
      });
    }
    
    console.log('📥 Received reprocess request from:', userEmail);
    console.log('   dbName:', dbName);
    console.log('   platform:', req.user.platform);
    
    // Allow overriding stored values with request body values
    const {
      categories,
      type: userTypes,
      softCategories,
      targetCategory,
      missingSoftCategoryOnly,
      reprocessHardCategories,
      reprocessSoftCategories,
      reprocessTypes,
      reprocessVariants,
      reprocessEmbeddings,
      reprocessDescriptions,
      reprocessAll,
      incrementalMode,
      incrementalSoftCategories
    } = req.body;

    // Handle incremental mode - merge new soft categories with existing ones
    let finalSoftCategories = softCategories || storedSoftCategories;
    if (incrementalMode && incrementalSoftCategories && incrementalSoftCategories.length > 0) {
      console.log('📊 [REPROCESS] Incremental mode detected');
      console.log('   Current soft categories:', finalSoftCategories);
      console.log('   New soft categories to add:', incrementalSoftCategories);

      // Merge and remove duplicates
      const mergedCategories = [...new Set([...finalSoftCategories, ...incrementalSoftCategories])];
      finalSoftCategories = mergedCategories;

      console.log('   Merged soft categories:', finalSoftCategories);

      // Update user document with merged soft categories
      try {
        const clientPromise = await import('../lib/mongodb.js');
        const client = await clientPromise.default;
        const usersDb = client.db("users");
        const usersCollection = usersDb.collection("users");

        await usersCollection.updateOne(
          { dbName: dbName },
          { $set: { softCategories: mergedCategories } }
        );
        console.log(`✅ [REPROCESS] Updated user softCategories: added ${incrementalSoftCategories.length} new categories`);
        console.log(`   New total soft categories: ${mergedCategories.length}`);
      } catch (updateErr) {
        console.error("⚠️ [REPROCESS] Failed to update user softCategories:", updateErr);
        // Continue anyway - the reprocessing will still work
      }
    }

    await setJobState(dbName, "running");

    const payload = {
      dbName,
      userEmail, // Include userEmail from authenticated user
      categories: categories || storedCategories,
      userTypes: userTypes || storedTypes,
      softCategories: finalSoftCategories,
      targetCategory: targetCategory || null,
      missingSoftCategoryOnly: missingSoftCategoryOnly || false,
      incrementalMode: incrementalMode || false,
      incrementalSoftCategories: incrementalSoftCategories || [],
      options: {
        reprocessHardCategories: reprocessHardCategories !== undefined ? reprocessHardCategories : true,
        reprocessSoftCategories: reprocessSoftCategories !== undefined ? reprocessSoftCategories : true,
        reprocessTypes: reprocessTypes !== undefined ? reprocessTypes : true,
        reprocessVariants: reprocessVariants !== undefined ? reprocessVariants : true,
        reprocessEmbeddings: reprocessEmbeddings !== undefined ? reprocessEmbeddings : false,
        reprocessDescriptions: reprocessDescriptions !== undefined ? reprocessDescriptions : false,
        reprocessAll: reprocessAll !== undefined ? reprocessAll : false
      }
    };

    console.log('✅ Reprocess payload prepared:', {
      dbName: payload.dbName,
      userEmail: payload.userEmail,
      categoriesCount: payload.categories.length,
      typesCount: payload.userTypes.length,
      softCategoriesCount: payload.softCategories.length,
      incrementalMode: payload.incrementalMode || false,
      incrementalSoftCategoriesCount: payload.incrementalSoftCategories?.length || 0
    });

    // Start processing in background
    processReprocessInBackground(payload);

    res.json({ 
      state: "running",
      message: "Reprocessing started in background",
      user: {
        email: userEmail,
        platform: req.user.platform
      }
    });

  } catch (error) {
    console.error("Reprocess error:", error);
    res.status(500).json({ error: error.message });
  }
});

async function processReprocessInBackground(payload) {
  const startTime = Date.now();
  console.log('\n' + '='.repeat(80));
  console.log('🔄 [REPROCESS BACKGROUND] Starting reprocessing job');
  console.log('   User:', payload.userEmail);
  console.log('   Database:', payload.dbName);
  console.log('   Categories:', payload.categories?.length || 0);
  console.log('   Types:', payload.userTypes?.length || 0);
  console.log('   Soft Categories:', payload.softCategories?.length || 0);
  if (payload.incrementalMode) {
    console.log('   🔄 INCREMENTAL MODE ACTIVE');
    console.log('   New soft categories added:', payload.incrementalSoftCategories?.length || 0);
  }
  console.log('   Options:', JSON.stringify(payload.options, null, 2));
  console.log('='.repeat(80) + '\n');
  
  try {
    await reprocessProducts(payload);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    await setJobState(payload.dbName, "done");
    console.log('\n' + '='.repeat(80));
    console.log('✅ [REPROCESS BACKGROUND] Reprocessing completed successfully');
    console.log('   Duration:', duration, 'seconds');
    console.log('   User:', payload.userEmail);
    console.log('   Database:', payload.dbName);
    console.log('='.repeat(80) + '\n');
  } catch (err) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error('\n' + '='.repeat(80));
    console.error('❌ [REPROCESS BACKGROUND] Reprocessing failed');
    console.error('   Duration:', duration, 'seconds');
    console.error('   User:', payload.userEmail);
    console.error('   Database:', payload.dbName);
    console.error('   Error:', err.message);
    console.error('   Stack:', err.stack);
    console.error('='.repeat(80) + '\n');
    await setJobState(payload.dbName, "error");
  }
}

// Get logs endpoint - fetch real-time logs from database
router.get('/logs', async (req, res) => {
  try {
    const dbName = req.user.dbName;
    const userEmail = req.user.email;
    
    console.log('📋 [LOGS] Fetching logs for:', userEmail, 'dbName:', dbName);
    
    const clientPromise = await import('../lib/mongodb.js');
    const client = await clientPromise.default;
    const db = client.db(dbName);
    const statusCol = db.collection('sync_status');
    
    const status = await statusCol.findOne({ dbName });
    
    res.json({
      state: status?.state || 'idle',
      logs: status?.logs || [],
      progress: status?.progress || 0,
      done: status?.done || 0,
      total: status?.total || 0,
      startedAt: status?.startedAt,
      finishedAt: status?.finishedAt
    });
  } catch (error) {
    console.error('❌ [LOGS] Error fetching logs:', error);
    res.status(500).json({ error: error.message });
  }
});

// Stop endpoint
router.post('/stop', async (req, res) => {
  try {
    // Get dbName from authenticated user
    const dbName = req.user.dbName;
    const userEmail = req.user.email;
    
    console.log('\n' + '='.repeat(80));
    console.log('🛑 [STOP] Stop request received');
    console.log('   User:', userEmail);
    console.log('   Database:', dbName);
    console.log('='.repeat(80) + '\n');
    
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    
    const LOCK_DIR = os.tmpdir();
    const lockFilePath = path.join(LOCK_DIR, `reprocessing_${dbName}.lock`);
    
    console.log('🔍 [STOP] Checking lock file:', lockFilePath);
    
    try {
      await fs.access(lockFilePath);
      console.log('✅ [STOP] Lock file exists, removing...');
      await fs.unlink(lockFilePath);
      console.log('✅ [STOP] Lock file removed successfully');
      
      // Also update the status in database
      await setJobState(dbName, "stopped");
      
      res.json({ 
        message: "Stop signal sent successfully. Processing will halt after current product.",
        user: {
          email: userEmail,
          dbName: dbName
        }
      });
    } catch (accessError) {
      if (accessError.code === 'ENOENT') {
        console.log('ℹ️  [STOP] Lock file does not exist - process already stopped or finished');
        res.json({ message: "Process already stopped or finished." });
      } else {
        throw accessError;
      }
    }
  } catch (error) {
    console.error('❌ [STOP] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;


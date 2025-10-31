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
      reprocessAll
    } = req.body;

    await setJobState(dbName, "running");

    const payload = {
      dbName,
      userEmail, // Include userEmail from authenticated user
      categories: categories || storedCategories,
      userTypes: userTypes || storedTypes,
      softCategories: softCategories || storedSoftCategories,
      targetCategory: targetCategory || null,
      missingSoftCategoryOnly: missingSoftCategoryOnly || false,
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
      typesCount: payload.userTypes.length
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
  try {
    await reprocessProducts(payload);
    await setJobState(payload.dbName, "done");
    console.log("✅ Reprocessing completed");
  } catch (err) {
    console.error("❌ Reprocessing error:", err);
    await setJobState(payload.dbName, "error");
  }
}

// Stop endpoint
router.post('/stop', async (req, res) => {
  try {
    // Get dbName from authenticated user
    const dbName = req.user.dbName;
    const userEmail = req.user.email;
    
    console.log('🛑 Stop request from:', userEmail, 'for dbName:', dbName);
    
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    
    const LOCK_DIR = os.tmpdir();
    const lockFilePath = path.join(LOCK_DIR, `reprocessing_${dbName}.lock`);
    
    await fs.unlink(lockFilePath);
    res.json({ 
      message: "Stop signal sent.",
      user: {
        email: userEmail,
        dbName: dbName
      }
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      res.json({ message: "Process already stopped or finished." });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

export default router;


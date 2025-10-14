import express from 'express';
import reprocessProducts from '../lib/reprocess-products.js';
import { setJobState } from '../lib/syncStatus.js';

const router = express.Router();

router.post('/', async (req, res) => {
  const {
    dbName,
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

  console.log('📥 Received reprocess request:', { dbName });

  if (!dbName || !categories) {
    return res.status(400).json({ error: "Missing required data" });
  }

  try {
    await setJobState(dbName, "running");

    const payload = {
      dbName,
      categories,
      userTypes: userTypes || [],
      softCategories: softCategories || [],
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

    // Start processing in background
    processReprocessInBackground(payload);

    res.json({ 
      state: "running",
      message: "Reprocessing started in background"
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
  const { dbName } = req.body;
  
  if (!dbName) {
    return res.status(400).json({ error: "dbName is required" });
  }
  
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    
    const LOCK_DIR = os.tmpdir();
    const lockFilePath = path.join(LOCK_DIR, `reprocessing_${dbName}.lock`);
    
    await fs.unlink(lockFilePath);
    res.json({ message: "Stop signal sent." });
  } catch (error) {
    if (error.code === "ENOENT") {
      res.json({ message: "Process already stopped or finished." });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

export default router;


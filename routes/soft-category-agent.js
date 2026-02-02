import express from 'express';
import runDailySoftCategoryAgent from '../lib/daily-soft-category-agent.js';

const router = express.Router();

/**
 * POST /api/soft-category-agent/run
 * Manually trigger the daily soft category agent
 * This endpoint is protected and requires authentication
 */
router.post('/run', async (req, res) => {
  try {
    console.log('📊 [SOFT CATEGORY AGENT] Manual trigger requested');
    console.log('   User:', req.user?.email || 'Unknown');

    // Run the agent in the background
    runDailySoftCategoryAgent()
      .then(() => {
        console.log('✅ [SOFT CATEGORY AGENT] Background execution completed');
      })
      .catch(err => {
        console.error('❌ [SOFT CATEGORY AGENT] Background execution failed:', err);
      });

    res.json({
      message: 'Daily soft category agent started in background',
      status: 'running',
      triggeredBy: req.user?.email || 'manual',
      triggeredAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ [SOFT CATEGORY AGENT] Error:', error);
    res.status(500).json({
      error: error.message,
      status: 'error'
    });
  }
});

/**
 * GET /api/soft-category-agent/status
 * Get the status of the agent (for future expansion - could track runs in DB)
 */
router.get('/status', async (req, res) => {
  try {
    // For now, just return a simple status
    // In the future, we could track agent runs in MongoDB
    res.json({
      status: 'ok',
      message: 'Soft category agent is configured and ready',
      lastRun: null, // TODO: Track in database
      nextScheduledRun: null // TODO: Add when cron is implemented
    });
  } catch (error) {
    console.error('❌ [SOFT CATEGORY AGENT] Status error:', error);
    res.status(500).json({
      error: error.message,
      status: 'error'
    });
  }
});

export default router;

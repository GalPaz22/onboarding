import cron from 'node-cron';
import runDailySoftCategoryAgent from './daily-soft-category-agent.js';

/**
 * Initialize the cron scheduler for daily tasks
 */
export function initializeScheduler() {
  console.log('⏰ Initializing task scheduler...');

  // Run daily at 2 AM UTC
  // Cron format: minute hour day month weekday
  // '0 2 * * *' = At 2:00 AM every day
  const dailyTask = cron.schedule('0 2 * * *', async () => {
    console.log('\n' + '='.repeat(80));
    console.log('⏰ SCHEDULED TASK: Daily Soft Category Agent');
    console.log('   Triggered at:', new Date().toISOString());
    console.log('='.repeat(80));

    try {
      await runDailySoftCategoryAgent();
      console.log('✅ Scheduled daily agent completed successfully');
    } catch (error) {
      console.error('❌ Scheduled daily agent failed:', error);
    }
  }, {
    scheduled: true,
    timezone: "UTC"
  });

  console.log('✅ Daily soft category agent scheduled at 2:00 AM UTC');
  console.log('   Next run:', getNextRunTime());

  // Optional: Run on startup for testing (commented out by default)
  // setTimeout(() => {
  //   console.log('🔄 Running initial agent execution on startup...');
  //   runDailySoftCategoryAgent().catch(err => {
  //     console.error('❌ Initial agent execution failed:', err);
  //   });
  // }, 5000);

  return { dailyTask };
}

/**
 * Get the next scheduled run time
 */
function getNextRunTime() {
  const now = new Date();
  const next = new Date(now);

  // Set to 2 AM
  next.setUTCHours(2, 0, 0, 0);

  // If 2 AM has already passed today, schedule for tomorrow
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next.toISOString();
}

export default initializeScheduler;

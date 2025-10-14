import clientPromise from './mongodb.js';

/**
 * Set the job state for a database
 * @param {string} dbName - Database name
 * @param {string} state - Job state: "idle", "running", "done", "error"
 * @param {number} progress - Progress percentage (0-100)
 * @param {number} done - Number of items completed
 * @param {number} total - Total number of items
 */
export async function setJobState(dbName, state, progress = 0, done = 0, total = 0) {
  try {
    const client = await clientPromise;
    const db = client.db(dbName);
    const statusCol = db.collection("sync_status");

    await statusCol.updateOne(
      { dbName },
      {
        $set: {
          dbName,
          state,
          progress,
          done,
          total,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    console.log(`📊 Job state updated: ${dbName} -> ${state} (${progress}%)`);
  } catch (error) {
    console.error(`Error updating job state for ${dbName}:`, error);
    throw error;
  }
}

/**
 * Get the job state for a database
 * @param {string} dbName - Database name
 * @returns {Promise<Object>} Job state object
 */
export async function getJobState(dbName) {
  try {
    const client = await clientPromise;
    const db = client.db(dbName);
    const statusCol = db.collection("sync_status");

    const status = await statusCol.findOne({ dbName });
    return status || { state: "idle", progress: 0, done: 0, total: 0 };
  } catch (error) {
    console.error(`Error getting job state for ${dbName}:`, error);
    throw error;
  }
}


# 📊 Logging and Stop Mechanism Guide

## Overview

The system now includes comprehensive server-side logging and the ability to stop long-running processes.

---

## 🔍 Server-Side Logging

### What Gets Logged

**Onboarding Process:**
- Start time and configuration details
- User email, platform, database name
- Sync mode (full/image)
- Categories, types, and soft categories counts
- Processing duration
- Success/failure with detailed error messages

**Reprocessing Process:**
- Start time and configuration
- User identification
- Reprocessing options
- Progress updates from lib/reprocess-products.js
- Processing duration
- Success/failure with detailed error messages

### Log Format

All major operations use a consistent format:

```
================================================================================
🚀 [OPERATION] Description
   User: user@example.com
   Database: store-db
   Duration: 45.23 seconds
================================================================================
```

### Where Logs Appear

1. **Server Console** - Real-time logs visible in your server terminal/deployment logs
2. **Database** - Logs stored in `sync_status` collection for each database
3. **API Response** - Logs returned in the response for synchronous operations

---

## 📋 Viewing Logs

### From the Test UI

1. Start a reprocessing job
2. Click **"📋 View Logs"** button
3. Logs display with:
   - Current state (running, done, error, stopped)
   - Progress percentage
   - Products done / total
   - All log messages in chronological order

### From API

**Endpoint:** `GET /api/reprocess/logs`

**Headers:**
```
x-api-key: your-api-key-here
```

**Response:**
```json
{
  "state": "running",
  "logs": ["Log message 1", "Log message 2", ...],
  "progress": 45,
  "done": 450,
  "total": 1000,
  "startedAt": "2024-01-01T00:00:00.000Z",
  "finishedAt": null
}
```

**Example curl:**
```bash
curl http://localhost:3001/api/reprocess/logs \
  -H "x-api-key: your-api-key"
```

---

## 🛑 Stop Mechanism

### How It Works

The system uses a **lock file** mechanism:

1. When processing starts, a lock file is created: `/tmp/reprocessing_${dbName}.lock`
2. The worker checks for this file periodically (before each product)
3. When stop is requested, the lock file is deleted
4. Worker detects missing lock file and gracefully exits after current product

### Stopping a Process

#### From Test UI

1. Click **"🛑 Stop Reprocessing"** button
2. Confirm the action
3. System sends stop signal
4. Processing halts after current product completes

#### From API

**Endpoint:** `POST /api/reprocess/stop`

**Headers:**
```
x-api-key: your-api-key-here
```

**Response:**
```json
{
  "message": "Stop signal sent successfully. Processing will halt after current product.",
  "user": {
    "email": "user@example.com",
    "dbName": "store-db"
  }
}
```

**Example curl:**
```bash
curl -X POST http://localhost:3001/api/reprocess/stop \
  -H "x-api-key: your-api-key"
```

### Stop Behavior

- ✅ Graceful shutdown - completes current product before stopping
- ✅ Database state updated to "stopped"
- ✅ Lock file removed from filesystem
- ✅ All database connections properly closed
- ✅ No data corruption or partial updates

### If Process Already Stopped

If you request stop when no process is running:

```json
{
  "message": "Process already stopped or finished."
}
```

---

## 🔄 Real-Time Monitoring

### Auto-Refresh Logs

You can poll the logs endpoint to monitor progress:

```javascript
setInterval(async () => {
  const response = await fetch('/api/reprocess/logs', {
    headers: { 'x-api-key': apiKey }
  });
  const data = await response.json();
  console.log('Progress:', data.progress + '%');
  console.log('State:', data.state);
}, 2000); // Every 2 seconds
```

### Status States

- `idle` - No processing happening
- `running` - Currently processing
- `done` - Successfully completed
- `error` - Failed with errors
- `stopped` - Manually stopped by user

---

## 🐛 Debugging

### Check Server Logs

All operations log to the server console with clear formatting:

```bash
# Follow server logs
tail -f /var/log/your-app.log

# Or if running locally
npm start
```

### Check Database Logs

```javascript
// Query sync_status collection
db.sync_status.findOne({ dbName: "your-db-name" })
```

### Log Levels

- 🚀 **Start** - Operation beginning
- ✅ **Success** - Operation completed
- ❌ **Error** - Operation failed
- 🛑 **Stop** - User-initiated stop
- 📋 **Info** - General information
- 🔍 **Debug** - Detailed debugging info

---

## 📊 Example Log Output

```
================================================================================
🔄 [REPROCESS BACKGROUND] Starting reprocessing job
   User: user@example.com
   Database: wine-store-db
   Categories: 12
   Types: 3
   Options: {
     "reprocessHardCategories": true,
     "reprocessSoftCategories": true,
     "reprocessTypes": true,
     "reprocessVariants": true,
     "reprocessEmbeddings": false,
     "reprocessDescriptions": false,
     "reprocessAll": false
   }
================================================================================

🔍 Classifying with variants for: פונטרוטולי סיאפי
📝 Classification context built with metadata (582 chars)
✅ Classification: יין אדום, Types: כשר, Soft Categories: מבצע

================================================================================
✅ [REPROCESS BACKGROUND] Reprocessing completed successfully
   Duration: 245.67 seconds
   User: user@example.com
   Database: wine-store-db
================================================================================
```

---

## 🔒 Security

- Logs are filtered by user's API key
- Each user can only see/stop their own processes
- Lock files use database name to prevent conflicts
- All operations require authentication

---

## 💡 Best Practices

1. **Monitor long jobs** - Use the logs endpoint to track progress
2. **Stop gracefully** - Always use the stop endpoint rather than killing the server
3. **Check logs on errors** - Server logs contain detailed stack traces
4. **Database state** - sync_status collection persists across restarts
5. **Clean up** - Lock files are automatically removed on completion or stop


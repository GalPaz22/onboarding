# Daily Soft Category Agent

## Overview

The Daily Soft Category Agent is an intelligent automation system that analyzes potential soft categories from user queries and automatically increments the best ones into your product classification system.

## How It Works

### 1. Data Collection
The system expects users to have a `credentials.potentialSoftCategories` field in their user document, which contains:

```json
{
  "credentials": {
    "potentialSoftCategories": {
      "term1": {
        "count": 10,
        "firstSeen": "2026-01-15T10:00:00.000Z",
        "lastSeen": "2026-02-02T14:30:00.000Z",
        "exampleQueries": ["query 1", "query 2", "query 3"]
      },
      "term2": {
        "count": 5,
        "firstSeen": "2026-01-20T11:00:00.000Z",
        "lastSeen": "2026-02-01T09:15:00.000Z",
        "exampleQueries": ["query 4", "query 5"]
      }
    },
    "softCategories": ["existing1", "existing2", ...]
  }
}
```

### 2. Intelligent Analysis
The agent uses an LLM (Gemini) to analyze potential terms based on:

- **Usage Frequency**: Terms with higher `count` values
- **Recency**: Terms with recent `lastSeen` dates
- **Search Intent**: Quality of `exampleQueries`
- **Uniqueness**: Avoids duplicates or synonyms of existing categories
- **Clarity**: Prefers specific, actionable terms

### 3. Automatic Incrementation
For each user:
1. Selects the **top 5** terms that don't already exist in `softCategories`
2. Appends them to the existing `softCategories` array
3. Updates the user document in MongoDB
4. Triggers **incremental reprocessing** (only updates soft categories, preserves embeddings)

## Scheduling

The agent runs automatically **once per day at 2:00 AM UTC**.

### Configuration
Schedule is defined in `lib/scheduler.js`:
```javascript
// '0 2 * * *' = At 2:00 AM every day
cron.schedule('0 2 * * *', async () => {
  await runDailySoftCategoryAgent();
});
```

To change the schedule, modify the cron expression:
- `0 2 * * *` - 2:00 AM daily
- `0 */6 * * *` - Every 6 hours
- `0 0 * * 0` - Every Sunday at midnight

## Manual Triggering

### API Endpoint
You can manually trigger the agent via API:

**POST** `/api/soft-category-agent/run`

**Headers:**
```
X-API-Key: your-api-key
```

**Response:**
```json
{
  "message": "Daily soft category agent started in background",
  "status": "running",
  "triggeredBy": "user@example.com",
  "triggeredAt": "2026-02-02T16:00:00.000Z"
}
```

### Command Line
Run the agent directly from the command line:

```bash
node lib/daily-soft-category-agent.js
```

## Fallback Algorithm

If the LLM is unavailable, the agent uses a scoring algorithm:

**Score Formula:**
```
Total Score = (count × 0.5) + (recency × 0.3) + (persistence × 0.2)
```

Where:
- **count**: Number of times the term appeared in queries
- **recency**: 100 - days since last seen (more recent = higher)
- **persistence**: Days between first and last seen (longer = higher)

## Monitoring

### Check Status
**GET** `/api/soft-category-agent/status`

### Logs
The agent outputs detailed logs:
- Users processed
- Terms selected for each user
- Reprocessing triggered
- Errors encountered

Example output:
```
🤖 DAILY SOFT CATEGORY AGENT STARTED
📊 Found 3 users with potentialSoftCategories

👤 Processing user: shop@example.com
   Current soft categories: 129
   Potential categories: 15
   New terms available: 8
   ✅ Selected 5 new terms: ["purple", "orange", "striped", "floral", "vintage"]
   🔄 Triggering incremental reprocessing...

🎉 DAILY SOFT CATEGORY AGENT COMPLETED
   Total users processed: 3
   Successful: 3
   Skipped: 0
   Errors: 0
```

## Benefits

1. **Automated Discovery**: Finds valuable categories from user behavior
2. **Smart Selection**: Uses AI to pick the most relevant terms
3. **Efficient Processing**: Incremental updates preserve existing data
4. **Zero Downtime**: Runs in background without affecting service
5. **Cost-Effective**: Only reprocesses soft categories, not full pipeline

## Requirements

- Google AI API key (`GOOGLE_AI_API_KEY` in `.env`)
- MongoDB with user documents containing `potentialSoftCategories`
- Node.js 18+
- `node-cron` package installed

## Error Handling

The agent is resilient:
- Falls back to scoring algorithm if LLM fails
- Skips users with no potential categories
- Continues processing other users if one fails
- Logs all errors for monitoring

## Future Enhancements

- Track agent runs in database
- Send email reports of changes
- Allow per-user configuration (max terms, frequency)
- A/B testing of category effectiveness
- Feedback loop to remove unused categories

# Conversion Notes: Next.js API Route → Express Backend

This document outlines the changes made to convert the onboarding route from a Next.js API route with session-based authentication to an Express backend with API key authentication.

## Summary of Changes

### Authentication Model
- **Before**: Next-Auth session-based authentication (`getServerSession`)
- **After**: API key authentication via middleware (`authenticateRequest`)

### Route Handler Format
- **Before**: Next.js App Router format (`export async function POST(req)`)
- **After**: Express router format (`router.post('/', async (req, res)`)

### Request/Response Handling

#### Request Body
- **Before**: `await req.json()`
- **After**: `req.body` (parsed by Express middleware)

#### Query Parameters
- **Before**: `req.nextUrl.searchParams.get("dbName")`
- **After**: `req.query.dbName`

#### Response Format
- **Before**: `Response.json({ data }, { status: 200 })`
- **After**: `res.status(200).json({ data })`

### Key Feature Additions

1. **Platform Credential Validation**
   - `validateShopifyCredentials()` - Validates Shopify domain and access token
   - `validateWooCommerceCreds()` - Validates WooCommerce URL and API keys
   - Both functions test actual API connectivity before proceeding

2. **User Management**
   - Stores user credentials in MongoDB `users` database
   - Tracks trial status and onboarding completion
   - Associates each user with their platform and database name

3. **Index Creation**
   - `createEmbeddingIndex()` - Creates MongoDB Atlas Vector Search index
   - `createAutocompleteIndex()` - Creates Atlas Search autocomplete index  
   - `createProductIndexes()` - Creates standard MongoDB indexes for queries

### API Endpoints

#### POST /api/onboarding
**Headers**: `x-api-key: your-api-key`

**Request**:
```json
{
  "platform": "shopify|woocommerce",
  "dbName": "your-database-name",
  "userEmail": "user@example.com",
  "syncMode": "full|image",
  "categories": ["category1", "category2"],
  "type": ["type1", "type2"],
  "softCategories": ["soft1", "soft2"],
  "explain": false,
  
  // Shopify-specific
  "shopifyDomain": "store.myshopify.com",
  "shopifyToken": "shpat_xxxxx",
  "context": "additional context",
  
  // WooCommerce-specific
  "wooUrl": "https://store.com",
  "wooKey": "ck_xxxxx",
  "wooSecret": "cs_xxxxx"
}
```

**Response**:
```json
{
  "success": true,
  "state": "done",
  "isNewTrial": true,
  "logs": []
}
```

#### GET /api/onboarding/status
**Headers**: `x-api-key: your-api-key`

**Query**: `?dbName=your-database-name`

**Response**:
```json
{
  "state": "running|done|error|idle",
  "progress": 45,
  "done": 450,
  "total": 1000
}
```

## Processing Flow

1. **Authentication**: API key validated via middleware
2. **Validation**: Required fields checked (dbName, userEmail, platform)
3. **Credential Validation**: Platform credentials tested against live APIs
4. **User Record**: Credentials and settings stored in MongoDB
5. **Index Creation**: Database indexes created for efficient queries
6. **Job Initialization**: Job state set to "running" in sync_status collection
7. **Processing**: Synchronous processing based on platform and syncMode
   - Shopify: `processShopify()` or `processShopifyImages()`
   - WooCommerce: `processWooProducts()` or `processWooImages()`
8. **Completion**: Job state updated to "done" or "error"
9. **Response**: Returns success status with logs and trial information

## Database Schema

### users.users Collection
```javascript
{
  email: string,
  credentials: {
    // Shopify
    shopifyDomain?: string,
    shopifyToken?: string,
    
    // WooCommerce  
    wooUrl?: string,
    wooKey?: string,
    wooSecret?: string,
    
    // Common
    categories: string[],
    dbName: string,
    type: string[],
    softCategories: string[]
  },
  onboardingComplete: boolean,
  dbName: string,
  platform: "shopify" | "woocommerce",
  syncMode: "full" | "image",
  context?: string,
  explain: boolean,
  trialStartedAt: Date,
  trialStatus: "active" | "expired",
  updatedAt: Date
}
```

### {dbName}.sync_status Collection
```javascript
{
  dbName: string,
  state: "idle" | "running" | "done" | "error",
  progress: number,  // 0-100
  done: number,      // items completed
  total: number,     // total items
  updatedAt: Date
}
```

### {dbName}.products Collection
Indexes created:
- `category + fetchedAt` (compound)
- `type + fetchedAt` (compound)
- `softCategory + fetchedAt` (compound)
- `stockStatus + fetchedAt` (compound)
- `description1 + fetchedAt` (compound)
- `name + description1` (text search)
- `category + stockStatus + fetchedAt` (compound)
- `softCategory + stockStatus + fetchedAt` (compound)

Atlas Search Indexes:
- `vector_index` - Vector search on embeddings (3072 dimensions, cosine similarity)
- `default` - Autocomplete on name and description fields

## Error Handling

The route includes comprehensive error handling:
- Missing required fields → 400 Bad Request
- Invalid platform credentials → 401 Unauthorized  
- Invalid platform type → 400 Bad Request
- Database errors → 500 Internal Server Error
- Processing errors → 500 with error details

All errors are logged to console with context for debugging.

## Next Steps

The lib files still need to be implemented:
- `lib/processShopify.js`
- `lib/processShopifyImages.js`
- `lib/processWoo.js`
- `lib/processWooImages.js`

These should contain the actual logic for:
- Fetching products from platform APIs
- Processing and categorizing products
- Generating embeddings with OpenAI
- Storing results in MongoDB
- Updating progress via `setJobState()`


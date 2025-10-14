# Semantix Processing Service

A standalone backend service for processing and onboarding products from Shopify and WooCommerce platforms. This service handles product synchronization, image processing, categorization, and AI-powered enrichment.

## 🏗️ Architecture

This service is designed to run independently from your Next.js application, providing:
- Asynchronous product processing
- Background job management
- Secure API endpoints
- MongoDB integration
- OpenAI integration for embeddings and categorization

## 📁 Project Structure

```
semantix-processing-service/
├── package.json
├── server.js                 # Main entry point
├── lib/                      # Core processing libraries
│   ├── mongodb.js           # MongoDB connection
│   ├── processShopify.js    # Shopify product processing
│   ├── processShopifyImages.js
│   ├── processWoo.js        # WooCommerce product processing
│   ├── processWooImages.js
│   ├── reprocess-products.js
│   ├── syncStatus.js        # Job status management
│   └── openai.js            # OpenAI utilities
├── routes/                   # API routes
│   ├── onboarding.js        # Onboarding endpoint
│   ├── reprocess.js         # Reprocessing endpoint
│   └── health.js            # Health check endpoint
└── middleware/
    └── auth.js              # API key authentication
```

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18.0.0
- MongoDB Atlas account or MongoDB instance
- OpenAI API key
- Shopify/WooCommerce store credentials

### Installation

1. Clone the repository or copy the files to your server

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

4. Configure your environment variables in `.env`:
```env
PORT=3001
NODE_ENV=production
SERVICE_API_KEY=your-secure-random-api-key
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/
OPENAI_API_KEY=sk-your-openai-api-key
ALLOWED_ORIGINS=https://yourfrontend.com
```

### Running the Service

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

## 📡 API Endpoints

All protected endpoints require an API key in the header or query parameter:
- Header: `x-api-key: your-api-key`
- Or query: `?api_key=your-api-key`

### Health Check
```
GET /health
```
No authentication required. Returns service health status.

### Onboarding
```
POST /api/onboarding
Headers: x-api-key: your-api-key
```

Start product synchronization from Shopify or WooCommerce. The service validates platform credentials before processing.

**Request Body:**
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
  
  // For Shopify:
  "shopifyDomain": "your-store.myshopify.com",
  "shopifyToken": "shpat_xxxxx",
  "context": "additional context",
  
  // For WooCommerce:
  "wooUrl": "https://your-store.com",
  "wooKey": "ck_xxxxx",
  "wooSecret": "cs_xxxxx"
}
```

**Response:**
```json
{
  "success": true,
  "state": "done",
  "isNewTrial": true,
  "logs": []
}
```

### Check Status
```
GET /api/onboarding/status?dbName=your-database-name
Headers: x-api-key: your-api-key
```

Returns current processing status.

**Response:**
```json
{
  "state": "running|done|error|idle",
  "progress": 45,
  "done": 450,
  "total": 1000
}
```

### Reprocess Products
```
POST /api/reprocess
```

Reprocess existing products with updated parameters.

**Request Body:**
```json
{
  "dbName": "your-database-name",
  "categories": ["category1", "category2"],
  "type": ["type1", "type2"],
  "softCategories": ["soft1", "soft2"],
  "targetCategory": "specific-category",
  "missingSoftCategoryOnly": false,
  "reprocessHardCategories": true,
  "reprocessSoftCategories": true,
  "reprocessTypes": true,
  "reprocessVariants": true,
  "reprocessEmbeddings": false,
  "reprocessDescriptions": false,
  "reprocessAll": false
}
```

### Stop Reprocessing
```
POST /api/reprocess/stop
```

Stop an ongoing reprocessing job.

**Request Body:**
```json
{
  "dbName": "your-database-name"
}
```

## 🔒 Security Features

- **API Key Authentication**: All endpoints (except health check) require a valid API key
- **Platform Credential Validation**: Validates Shopify/WooCommerce credentials before processing
- **Helmet**: Security headers automatically configured
- **CORS**: Configurable allowed origins
- **Rate Limiting**: 100 requests per 15 minutes per IP
- **Timing-safe comparisons**: Prevents timing attacks on API key validation

## 🚢 Deployment

### Render.com

1. Connect your repository to Render
2. Create a new Web Service
3. Configure build command: `npm install`
4. Configure start command: `npm start`
5. Add environment variables in Render dashboard
6. Deploy!

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

### Other Platforms

This service can be deployed to any Node.js hosting platform:
- Heroku
- Railway
- DigitalOcean App Platform
- AWS Elastic Beanstalk
- Google Cloud Run

## 🛠️ Development

### Adding New Processing Logic

The lib files are currently placeholders. Implement your processing logic in:
- `lib/processShopify.js` - Shopify product processing
- `lib/processShopifyImages.js` - Shopify image processing
- `lib/processWoo.js` - WooCommerce product processing
- `lib/processWooImages.js` - WooCommerce image processing
- `lib/reprocess-products.js` - Reprocessing logic

### Database Indexes

The service automatically creates necessary indexes on first run:
- Vector search index for embeddings
- Text search index for autocomplete
- Product field indexes for queries

## 📝 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| PORT | Server port (default: 3001) | No |
| NODE_ENV | Environment (development/production) | No |
| SERVICE_API_KEY | API key for authentication | Yes |
| MONGODB_URI | MongoDB connection string | Yes |
| OPENAI_API_KEY | OpenAI API key | Yes |
| ALLOWED_ORIGINS | Comma-separated list of allowed origins | No |

## 🤝 Integration with Next.js

Call this service from your Next.js API routes or server actions:

```javascript
// In your Next.js app
const response = await fetch('https://your-processing-service.com/api/onboarding', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.PROCESSING_SERVICE_API_KEY
  },
  body: JSON.stringify({
    platform: 'shopify',
    dbName: 'user-db-123',
    userEmail: 'user@example.com',
    shopifyDomain: 'store.myshopify.com',
    shopifyToken: 'token',
    categories: ['Electronics', 'Clothing'],
    syncMode: 'full'
  })
});

const result = await response.json();
```

## 📊 Monitoring

The service logs important events to the console:
- 🚀 Server startup
- 📥 Incoming requests
- ✅ Successful operations
- ❌ Errors and failures
- 📊 Job state updates

Consider integrating with logging services like:
- LogDNA
- Papertrail
- DataDog
- Sentry

## 📄 License

MIT

## 🆘 Support

For issues or questions, please open an issue in the repository or contact support.


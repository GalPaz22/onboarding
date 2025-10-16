# 🚀 API Quick Start Guide

## Your API Key

Your backend API key is: **`semantix-api-key-2024-secure`**

This must be included in **ALL** requests to protected endpoints.

---

## ⚡ Quick Test

### 1. Start your server:
```bash
npm run dev
```

### 2. Test with the included script:
```bash
node test-api.js
```

### 3. Or test with curl:

#### Health Check (no auth needed):
```bash
curl http://localhost:3001/health
```

#### Status Check:
```bash
curl http://localhost:3001/api/onboarding/status?dbName=test-db \
  -H "x-api-key: semantix-api-key-2024-secure"
```

#### Start Onboarding:
```bash
curl -X POST http://localhost:3001/api/onboarding \
  -H "Content-Type: application/json" \
  -H "x-api-key: semantix-api-key-2024-secure" \
  -d '{
    "platform": "shopify",
    "dbName": "test-store",
    "userEmail": "test@example.com",
    "syncMode": "full",
    "shopifyDomain": "test-store.myshopify.com",
    "shopifyToken": "shpat_test123",
    "categories": ["Electronics"],
    "type": ["Physical"],
    "softCategories": ["Featured"]
  }'
```

---

## 📱 From Your Frontend (Next.js)

### Setup Environment Variables

In your Next.js app, create `.env.local`:
```env
PROCESSING_SERVICE_URL=http://localhost:3001
PROCESSING_SERVICE_API_KEY=semantix-api-key-2024-secure
```

### Create API Route (Proxy)

Create `app/api/onboarding/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    const response = await fetch(
      `${process.env.PROCESSING_SERVICE_URL}/api/onboarding`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.PROCESSING_SERVICE_API_KEY!
        },
        body: JSON.stringify(body)
      }
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
    
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
```

### Call from React Component

```typescript
'use client';

async function handleOnboarding() {
  const response = await fetch('/api/onboarding', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      platform: 'shopify',
      dbName: 'my-store',
      userEmail: 'user@example.com',
      syncMode: 'full',
      shopifyDomain: 'my-store.myshopify.com',
      shopifyToken: 'shpat_xxxxx',
      categories: ['Electronics', 'Clothing'],
      type: ['Physical Products'],
      softCategories: ['Featured']
    })
  });

  const result = await response.json();
  console.log(result);
}
```

---

## 🔑 Important: API Key in Headers

The API key **MUST** be sent in the `x-api-key` header:

```javascript
headers: {
  'x-api-key': 'semantix-api-key-2024-secure'
}
```

**NOT** in the body, **NOT** in the URL query string (though query string is supported as fallback).

---

## 📋 Request Format

### Shopify Onboarding
```json
{
  "platform": "shopify",
  "dbName": "your-db-name",
  "userEmail": "user@example.com",
  "syncMode": "full",
  
  "shopifyDomain": "your-store.myshopify.com",
  "shopifyToken": "shpat_xxxxx",
  
  "categories": ["Category1", "Category2"],
  "type": ["Type1", "Type2"],
  "softCategories": ["Soft1", "Soft2"],
  
  "context": "Optional context",
  "explain": false
}
```

### WooCommerce Onboarding
```json
{
  "platform": "woocommerce",
  "dbName": "your-db-name",
  "userEmail": "user@example.com",
  "syncMode": "full",
  
  "wooUrl": "https://your-store.com",
  "wooKey": "ck_xxxxx",
  "wooSecret": "cs_xxxxx",
  
  "categories": ["Category1", "Category2"],
  "type": ["Type1", "Type2"],
  "softCategories": ["Soft1", "Soft2"],
  
  "explain": false
}
```

---

## 📊 Response Format

### Success Response
```json
{
  "success": true,
  "state": "done",
  "isNewTrial": true,
  "logs": []
}
```

### Error Response
```json
{
  "error": "Invalid API key"
}
```

### Status Response
```json
{
  "state": "running",
  "progress": 45,
  "done": 450,
  "total": 1000
}
```

---

## 🐛 Troubleshooting

### Getting 401 Unauthorized?

1. **Check your .env file** - Make sure `SERVICE_API_KEY=semantix-api-key-2024-secure`
2. **Restart your server** - Changes to .env require restart
3. **Check the header name** - It's `x-api-key` not `X-API-Key` or `api-key`
4. **Check server logs** - The auth middleware now logs detailed debug info

### Server not starting?

```bash
# Make sure MongoDB URI is set
cat .env | grep MONGODB_URI

# Install dependencies
npm install

# Start server
npm run dev
```

### Frontend can't connect?

1. Check `PROCESSING_SERVICE_URL` in frontend `.env.local`
2. Make sure backend server is running
3. Check CORS settings - frontend URL should be in `ALLOWED_ORIGINS`

---

## 🔒 Security Notes

1. ✅ API key is in `.env` file (not in code)
2. ✅ `.env` is in `.gitignore` (won't be committed)
3. ✅ Frontend proxies requests through Next.js API routes (key never exposed to browser)
4. ✅ Use HTTPS in production
5. ✅ Rotate API keys periodically

---

## 🚀 Production Deployment

When deploying to Render/Heroku/etc:

1. Set environment variable `SERVICE_API_KEY` in dashboard
2. Set `MONGODB_URI` with your production database
3. Set `OPENAI_API_KEY` for AI features
4. Set `ALLOWED_ORIGINS` to your production frontend URLs
5. Update frontend `PROCESSING_SERVICE_URL` to production URL

Example production env:
```env
PORT=3001
NODE_ENV=production
SERVICE_API_KEY=prod-secure-key-different-from-dev
MONGODB_URI=mongodb+srv://...
OPENAI_API_KEY=sk-...
ALLOWED_ORIGINS=https://myapp.com,https://www.myapp.com
```

---

## 📚 More Examples

See `FRONTEND_INTEGRATION.md` for complete examples with React hooks, status polling, and error handling.


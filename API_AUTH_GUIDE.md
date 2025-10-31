# 🔐 API Key Authentication Guide

## Overview

This service uses **per-user API keys** for authentication. Each user gets a unique API key that identifies them and gives access to their stored credentials and data.

### How It Works

1. **User onboards** → Server generates unique API key → Stores user data + credentials in MongoDB
2. **User makes requests** → Sends API key in header → Server looks up user in MongoDB → Attaches user data to request
3. **Routes use user data** → No need to send credentials again → Everything loaded from database

---

## 🚀 Quick Start

### Step 1: Onboarding (Get Your API Key)

**Endpoint:** `POST /api/onboarding` (No auth required)

This is the ONLY endpoint that doesn't require authentication. It creates your user account and returns your API key.

```bash
curl -X POST http://localhost:3001/api/onboarding \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "shopify",
    "userEmail": "your@email.com",
    "syncMode": "full",
    
    "shopifyDomain": "your-store.myshopify.com",
    "shopifyToken": "shpat_xxxxx",
    
    "categories": ["Electronics", "Clothing"],
    "type": ["Physical Products"],
    "softCategories": ["Featured", "New"]
  }'
```

**Response:**
```json
{
  "success": true,
  "state": "done",
  "isNewTrial": true,
  "apiKey": "a1b2c3d4e5f6...your-unique-64-char-key",
  "logs": []
}
```

**💾 SAVE YOUR API KEY!** You'll need it for all future requests.

---

### Step 2: Use Your API Key for All Other Requests

Once you have your API key, include it in the `x-api-key` header for all requests:

```javascript
headers: {
  'x-api-key': 'your-api-key-here'
}
```

---

## 📡 API Endpoints

### 1. Health Check
```
GET /health
```
**Auth:** None required

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "services": {
    "mongodb": "connected",
    "openai": "configured"
  }
}
```

---

### 2. Onboarding (Get API Key)
```
POST /api/onboarding
```
**Auth:** None required (this generates your API key)

**Request Body:**
```json
{
  "platform": "shopify|woocommerce",
  "userEmail": "your@email.com",
  "syncMode": "full|image",
  
  // Shopify
  "shopifyDomain": "store.myshopify.com",
  "shopifyToken": "shpat_xxxxx",
  "context": "optional context for image processing",
  
  // WooCommerce
  "wooUrl": "https://store.com",
  "wooKey": "ck_xxxxx",
  "wooSecret": "cs_xxxxx",
  
  // Common
  "categories": ["Category1", "Category2"],
  "type": ["Type1", "Type2"],
  "softCategories": ["Soft1", "Soft2"],
  "explain": false
}
```

**Response:**
```json
{
  "success": true,
  "state": "done",
  "isNewTrial": true,
  "apiKey": "your-unique-api-key-64-characters",
  "logs": []
}
```

---

### 3. Check Status
```
GET /api/onboarding/status
Headers: x-api-key: your-api-key
```
**Auth:** Required ✅

Uses your API key to identify you and check YOUR processing status.

**Response:**
```json
{
  "state": "running|done|error|idle",
  "progress": 45,
  "done": 450,
  "total": 1000,
  "user": {
    "email": "your@email.com",
    "platform": "shopify",
    "onboardingComplete": true
  }
}
```

---

### 4. Reprocess Products
```
POST /api/reprocess
Headers: x-api-key: your-api-key
```
**Auth:** Required ✅

Reprocess your products. The service automatically uses YOUR stored credentials from MongoDB.

**Request Body (all optional - uses your stored values by default):**
```json
{
  "categories": ["Override categories"],
  "type": ["Override types"],
  "softCategories": ["Override soft categories"],
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

**Response:**
```json
{
  "state": "running",
  "message": "Reprocessing started in background",
  "user": {
    "email": "your@email.com",
    "platform": "shopify"
  }
}
```

---

### 5. Stop Reprocessing
```
POST /api/reprocess/stop
Headers: x-api-key: your-api-key
```
**Auth:** Required ✅

Stops YOUR reprocessing job.

**Response:**
```json
{
  "message": "Stop signal sent.",
  "user": {
    "email": "your@email.com",
    "dbName": "your-db-name"
  }
}
```

---

## 📱 Frontend Integration (Next.js)

### Step 1: Store API Key

After onboarding, save the API key in your database or user session. **Never store it in browser localStorage/cookies for security!**

### Step 2: Create API Routes

```typescript
// app/api/reprocess/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // Get user's API key from your database
  const userApiKey = await getUserApiKey(session.user.email);
  
  const body = await req.json();
  
  // Call processing service with user's API key
  const response = await fetch(
    `${process.env.PROCESSING_SERVICE_URL}/api/reprocess`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': userApiKey // User's unique API key
      },
      body: JSON.stringify(body)
    }
  );

  return NextResponse.json(await response.json());
}
```

### Step 3: Call from Frontend

```typescript
// No API key needed in browser - handled server-side!
const response = await fetch('/api/reprocess', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    reprocessAll: true
  })
});
```

---

## 🗄️ MongoDB Schema

### users.users Collection

```javascript
{
  _id: ObjectId,
  email: "user@example.com",
  apiKey: "64-character-hex-string", // Unique per user
  
  // Platform & Settings
  platform: "shopify|woocommerce",
  dbName: "user-store-db",
  syncMode: "full|image",
  context: "optional context",
  explain: false,
  
  // Stored Credentials
  credentials: {
    // Shopify
    shopifyDomain: "store.myshopify.com",
    shopifyToken: "shpat_xxxxx",
    
    // WooCommerce
    wooUrl: "https://store.com",
    wooKey: "ck_xxxxx",
    wooSecret: "cs_xxxxx",
    
    // Common
    categories: ["Category1", "Category2"],
    type: ["Type1", "Type2"],
    softCategories: ["Soft1", "Soft2"],
    dbName: "user-store-db"
  },
  
  // Trial & Status
  onboardingComplete: true,
  trialStatus: "active|expired",
  trialStartedAt: ISODate,
  updatedAt: ISODate
}
```

---

## 🔒 Security Benefits

1. **✅ Each user has unique API key** - Can't access other users' data
2. **✅ Credentials stored server-side** - Not exposed in requests
3. **✅ API key identifies user** - No need to send sensitive data repeatedly
4. **✅ Easy to revoke** - Delete/regenerate API key in database
5. **✅ Audit trail** - Know which user made which request

---

## 🧪 Testing

### Test Onboarding (Get API Key)

```bash
curl -X POST http://localhost:3001/api/onboarding \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "shopify",
    "userEmail": "test@example.com",
    "syncMode": "full",
    "shopifyDomain": "test-store.myshopify.com",
    "shopifyToken": "shpat_test123",
    "categories": ["Test"],
    "type": ["Physical"],
    "softCategories": ["Featured"]
  }'
```

Save the `apiKey` from the response!

### Test Status Check

```bash
curl http://localhost:3001/api/onboarding/status \
  -H "x-api-key: YOUR_API_KEY_HERE"
```

### Test Reprocess

```bash
curl -X POST http://localhost:3001/api/reprocess \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY_HERE" \
  -d '{
    "reprocessAll": true
  }'
```

---

## 🐛 Troubleshooting

### "API key required" Error

- Make sure you're sending the `x-api-key` header
- Check spelling: `x-api-key` not `X-API-Key` or `api-key`

### "Invalid API key" Error

- API key doesn't exist in database
- Run onboarding again to get a new API key
- Check MongoDB connection

### "User not found" Error

- Your user record was deleted from MongoDB
- Run onboarding again to recreate it

### Missing userEmail Error

- This endpoint requires authentication
- Make sure you're sending the `x-api-key` header
- The service automatically gets your email from MongoDB

---

## 🔄 API Key Regeneration

To regenerate a user's API key (future feature):

```bash
POST /api/user/regenerate-key
Headers: x-api-key: old-api-key

Response:
{
  "apiKey": "new-64-character-key",
  "message": "API key regenerated successfully"
}
```

---

## 📊 What Data is Stored?

When you onboard, the service stores:
- ✅ Your email
- ✅ Your unique API key
- ✅ Your platform credentials (Shopify/WooCommerce tokens)
- ✅ Your categories, types, and soft categories
- ✅ Your database name and settings

When you make authenticated requests:
- ✅ Service looks up your data by API key
- ✅ Uses your stored credentials automatically
- ✅ No need to send credentials again
- ✅ Simplified and more secure!

---

## 🎯 Summary

1. **Onboard once** → Get your unique API key
2. **Use API key** → For all future requests
3. **Credentials auto-loaded** → From MongoDB using your API key
4. **Simple & Secure** → No credentials in every request!

**Your API key = Your identity + Your credentials + Your settings**



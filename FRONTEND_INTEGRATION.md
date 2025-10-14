# Frontend Integration Guide

This guide shows how to call the Semantix Processing Service API from your Next.js frontend.

## Prerequisites

1. **Service URL**: Your deployed backend URL (e.g., `https://your-service.onrender.com`)
2. **API Key**: The `SERVICE_API_KEY` you configured in your backend `.env`

## Environment Variables (Frontend)

Add these to your Next.js `.env.local`:

```env
NEXT_PUBLIC_PROCESSING_SERVICE_URL=https://your-service.onrender.com
PROCESSING_SERVICE_API_KEY=your-api-key-here
```

⚠️ **Note**: Don't use `NEXT_PUBLIC_` prefix for the API key - it should only be accessible server-side!

---

## 1. From Next.js API Routes (Server-Side)

### Example: Trigger Onboarding

```typescript
// app/api/trigger-onboarding/route.ts
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
        body: JSON.stringify({
          platform: body.platform, // "shopify" | "woocommerce"
          dbName: body.dbName,
          userEmail: body.userEmail,
          syncMode: body.syncMode, // "full" | "image"
          categories: body.categories,
          type: body.type,
          softCategories: body.softCategories,
          explain: body.explain || false,
          
          // Shopify
          shopifyDomain: body.shopifyDomain,
          shopifyToken: body.shopifyToken,
          context: body.context,
          
          // WooCommerce
          wooUrl: body.wooUrl,
          wooKey: body.wooKey,
          wooSecret: body.wooSecret
        })
      }
    );

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { error: error.message || 'Onboarding failed' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
    
  } catch (error) {
    console.error('Onboarding request error:', error);
    return NextResponse.json(
      { error: 'Failed to start onboarding' },
      { status: 500 }
    );
  }
}
```

### Example: Check Processing Status

```typescript
// app/api/check-status/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const dbName = req.nextUrl.searchParams.get('dbName');
    
    if (!dbName) {
      return NextResponse.json(
        { error: 'dbName is required' },
        { status: 400 }
      );
    }

    const response = await fetch(
      `${process.env.PROCESSING_SERVICE_URL}/api/onboarding/status?dbName=${dbName}`,
      {
        headers: {
          'x-api-key': process.env.PROCESSING_SERVICE_API_KEY!
        }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch status');
    }

    const data = await response.json();
    return NextResponse.json(data);
    
  } catch (error) {
    console.error('Status check error:', error);
    return NextResponse.json(
      { error: 'Failed to check status' },
      { status: 500 }
    );
  }
}
```

---

## 2. From Client Components (via your API routes)

### React Hook for Onboarding

```typescript
// hooks/useOnboarding.ts
import { useState } from 'react';

interface OnboardingData {
  platform: 'shopify' | 'woocommerce';
  dbName: string;
  userEmail: string;
  syncMode: 'full' | 'image';
  categories: string[];
  type: string[];
  softCategories: string[];
  
  // Platform-specific
  shopifyDomain?: string;
  shopifyToken?: string;
  context?: string;
  wooUrl?: string;
  wooKey?: string;
  wooSecret?: string;
}

interface OnboardingStatus {
  state: 'idle' | 'running' | 'done' | 'error';
  progress: number;
  done: number;
  total: number;
}

export function useOnboarding() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);

  const startOnboarding = async (data: OnboardingData) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/trigger-onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Onboarding failed');
      }

      const result = await response.json();
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const checkStatus = async (dbName: string) => {
    try {
      const response = await fetch(`/api/check-status?dbName=${dbName}`);
      
      if (!response.ok) {
        throw new Error('Failed to check status');
      }

      const data = await response.json();
      setStatus(data);
      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      throw err;
    }
  };

  return {
    startOnboarding,
    checkStatus,
    loading,
    error,
    status,
  };
}
```

### Example Component

```typescript
// components/OnboardingForm.tsx
'use client';

import { useState } from 'react';
import { useOnboarding } from '@/hooks/useOnboarding';

export function OnboardingForm() {
  const { startOnboarding, checkStatus, loading, error, status } = useOnboarding();
  const [platform, setPlatform] = useState<'shopify' | 'woocommerce'>('shopify');
  const [dbName, setDbName] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const result = await startOnboarding({
        platform,
        dbName,
        userEmail: 'user@example.com', // Get from your auth
        syncMode: 'full',
        categories: ['Electronics', 'Clothing'],
        type: ['physical', 'digital'],
        softCategories: ['Featured', 'New Arrivals'],
        
        // Shopify example
        shopifyDomain: 'your-store.myshopify.com',
        shopifyToken: 'shpat_xxxxx',
      });

      console.log('Onboarding started:', result);
      
      // Poll for status
      pollStatus();
    } catch (err) {
      console.error('Onboarding failed:', err);
    }
  };

  const pollStatus = async () => {
    const interval = setInterval(async () => {
      const statusData = await checkStatus(dbName);
      
      if (statusData.state === 'done' || statusData.state === 'error') {
        clearInterval(interval);
      }
    }, 2000); // Check every 2 seconds
  };

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-2xl font-bold mb-4">Start Onboarding</h2>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block mb-2">Platform</label>
          <select 
            value={platform} 
            onChange={(e) => setPlatform(e.target.value as any)}
            className="border p-2 rounded w-full"
          >
            <option value="shopify">Shopify</option>
            <option value="woocommerce">WooCommerce</option>
          </select>
        </div>

        <div>
          <label className="block mb-2">Database Name</label>
          <input
            type="text"
            value={dbName}
            onChange={(e) => setDbName(e.target.value)}
            className="border p-2 rounded w-full"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="bg-blue-500 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? 'Starting...' : 'Start Onboarding'}
        </button>
      </form>

      {error && (
        <div className="mt-4 p-4 bg-red-100 text-red-700 rounded">
          {error}
        </div>
      )}

      {status && (
        <div className="mt-4 p-4 bg-blue-100 rounded">
          <p>State: {status.state}</p>
          <p>Progress: {status.progress}%</p>
          <p>Done: {status.done} / {status.total}</p>
        </div>
      )}
    </div>
  );
}
```

---

## 3. Using Axios (Alternative)

```typescript
// lib/processingService.ts
import axios from 'axios';

const processingApi = axios.create({
  baseURL: process.env.PROCESSING_SERVICE_URL,
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.PROCESSING_SERVICE_API_KEY!
  }
});

export async function startOnboarding(data: any) {
  const response = await processingApi.post('/api/onboarding', data);
  return response.data;
}

export async function checkStatus(dbName: string) {
  const response = await processingApi.get(`/api/onboarding/status?dbName=${dbName}`);
  return response.data;
}

export async function startReprocessing(data: any) {
  const response = await processingApi.post('/api/reprocess', data);
  return response.data;
}

export async function stopReprocessing(dbName: string) {
  const response = await processingApi.post('/api/reprocess/stop', { dbName });
  return response.data;
}
```

---

## 4. Complete Example: Shopify Onboarding

```typescript
// Example: Full Shopify onboarding flow
const shopifyOnboarding = async () => {
  try {
    const response = await fetch('/api/trigger-onboarding', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        platform: 'shopify',
        dbName: 'my-store-db',
        userEmail: 'store@example.com',
        syncMode: 'full', // or 'image'
        
        // Shopify credentials
        shopifyDomain: 'my-store.myshopify.com',
        shopifyToken: 'shpat_xxxxxxxxxxxxx',
        
        // Categories and types
        categories: [
          'Electronics',
          'Clothing',
          'Home & Garden',
          'Sports'
        ],
        type: [
          'Physical Products',
          'Digital Products',
          'Services'
        ],
        softCategories: [
          'Featured',
          'New Arrivals',
          'Best Sellers',
          'On Sale'
        ],
        
        // Optional context for image processing
        context: 'Fashion and lifestyle products',
        explain: false
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message);
    }

    const result = await response.json();
    console.log('Onboarding result:', result);
    
    return result;
  } catch (error) {
    console.error('Onboarding error:', error);
    throw error;
  }
};
```

## 5. Complete Example: WooCommerce Onboarding

```typescript
// Example: Full WooCommerce onboarding flow
const wooCommerceOnboarding = async () => {
  try {
    const response = await fetch('/api/trigger-onboarding', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        platform: 'woocommerce',
        dbName: 'my-woo-store-db',
        userEmail: 'store@example.com',
        syncMode: 'full', // or 'image'
        
        // WooCommerce credentials
        wooUrl: 'https://my-store.com',
        wooKey: 'ck_xxxxxxxxxxxxxxxxxxxxx',
        wooSecret: 'cs_xxxxxxxxxxxxxxxxxxxxx',
        
        // Categories and types
        categories: [
          'Electronics',
          'Clothing',
          'Home & Garden'
        ],
        type: [
          'Physical Products',
          'Digital Products'
        ],
        softCategories: [
          'Featured',
          'New Arrivals',
          'Best Sellers'
        ],
        
        explain: false
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message);
    }

    const result = await response.json();
    console.log('Onboarding result:', result);
    
    return result;
  } catch (error) {
    console.error('Onboarding error:', error);
    throw error;
  }
};
```

---

## 6. Status Polling with React

```typescript
// hooks/useStatusPolling.ts
import { useEffect, useState, useRef } from 'react';

export function useStatusPolling(dbName: string, enabled: boolean = true) {
  const [status, setStatus] = useState<any>(null);
  const [isPolling, setIsPolling] = useState(enabled);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isPolling || !dbName) {
      return;
    }

    const pollStatus = async () => {
      try {
        const response = await fetch(`/api/check-status?dbName=${dbName}`);
        const data = await response.json();
        setStatus(data);

        // Stop polling if done or error
        if (data.state === 'done' || data.state === 'error') {
          setIsPolling(false);
        }
      } catch (error) {
        console.error('Status polling error:', error);
      }
    };

    // Poll immediately
    pollStatus();

    // Then poll every 2 seconds
    intervalRef.current = setInterval(pollStatus, 2000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [dbName, isPolling]);

  return { status, isPolling, stopPolling: () => setIsPolling(false) };
}
```

---

## API Response Types

### Onboarding Response
```typescript
interface OnboardingResponse {
  success: boolean;
  state: 'done' | 'error';
  isNewTrial: boolean;
  logs: any[];
}
```

### Status Response
```typescript
interface StatusResponse {
  state: 'idle' | 'running' | 'done' | 'error';
  progress: number; // 0-100
  done: number;
  total: number;
}
```

### Error Response
```typescript
interface ErrorResponse {
  error: string;
  message?: string;
}
```

---

## Security Best Practices

1. ✅ **Never expose API keys in client-side code**
2. ✅ **Always proxy requests through your Next.js API routes**
3. ✅ **Use environment variables for sensitive data**
4. ✅ **Validate user input before sending to backend**
5. ✅ **Handle errors gracefully**
6. ✅ **Implement rate limiting on your frontend**

---

## Testing the API

You can test the API directly with `curl`:

```bash
# Test onboarding endpoint
curl -X POST https://your-service.onrender.com/api/onboarding \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "platform": "shopify",
    "dbName": "test-db",
    "userEmail": "test@example.com",
    "syncMode": "full",
    "shopifyDomain": "test-store.myshopify.com",
    "shopifyToken": "shpat_xxxxx",
    "categories": ["Test"],
    "type": ["Physical"],
    "softCategories": ["Featured"]
  }'

# Check status
curl https://your-service.onrender.com/api/onboarding/status?dbName=test-db \
  -H "x-api-key: your-api-key"
```

---

## Troubleshooting

### CORS Errors
Make sure your frontend URL is in the `ALLOWED_ORIGINS` environment variable on the backend.

### 401 Unauthorized
Check that you're sending the correct API key in the `x-api-key` header.

### Connection Refused
Verify the backend service is running and the URL is correct.

### Timeout
The onboarding process runs synchronously. For large product catalogs, consider implementing a webhook or polling mechanism.


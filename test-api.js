// Test script for the onboarding API
// Run with: node test-api.js

const API_URL = 'http://localhost:3001';
const API_KEY = 'semantix-api-key-2024-secure'; // Must match SERVICE_API_KEY in .env

async function testOnboarding() {
  console.log('🧪 Testing Onboarding API...\n');
  
  try {
    const response = await fetch(`${API_URL}/api/onboarding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY  // ← API key goes here in headers
      },
      body: JSON.stringify({
        platform: 'shopify',
        dbName: 'test-store-db',
        userEmail: 'test@example.com',
        syncMode: 'full',
        
        // Shopify credentials
        shopifyDomain: 'test-store.myshopify.com',
        shopifyToken: 'shpat_test123',
        
        // Categories
        categories: ['Electronics', 'Clothing'],
        type: ['Physical Products'],
        softCategories: ['Featured', 'New'],
        
        context: 'Test store',
        explain: false
      })
    });

    console.log('Response Status:', response.status);
    console.log('Response Headers:', Object.fromEntries(response.headers));
    
    const data = await response.json();
    console.log('\n📥 Response Data:');
    console.log(JSON.stringify(data, null, 2));
    
    if (response.ok) {
      console.log('\n✅ Onboarding request successful!');
    } else {
      console.log('\n❌ Onboarding request failed!');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function testStatus() {
  console.log('\n🧪 Testing Status API...\n');
  
  try {
    const dbName = 'test-store-db';
    const response = await fetch(`${API_URL}/api/onboarding/status?dbName=${dbName}`, {
      method: 'GET',
      headers: {
        'x-api-key': API_KEY  // ← API key goes here in headers
      }
    });

    console.log('Response Status:', response.status);
    
    const data = await response.json();
    console.log('\n📥 Response Data:');
    console.log(JSON.stringify(data, null, 2));
    
    if (response.ok) {
      console.log('\n✅ Status request successful!');
    } else {
      console.log('\n❌ Status request failed!');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function testHealth() {
  console.log('\n🧪 Testing Health API (no auth required)...\n');
  
  try {
    const response = await fetch(`${API_URL}/health`);
    
    console.log('Response Status:', response.status);
    
    const data = await response.json();
    console.log('\n📥 Response Data:');
    console.log(JSON.stringify(data, null, 2));
    
    if (response.ok) {
      console.log('\n✅ Health check successful!');
    } else {
      console.log('\n❌ Health check failed!');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run tests
(async () => {
  console.log('═══════════════════════════════════════');
  console.log('  SEMANTIX API TEST SUITE');
  console.log('═══════════════════════════════════════\n');
  
  // Test health endpoint first (no auth)
  await testHealth();
  
  // Wait a bit
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test status endpoint
  await testStatus();
  
  // Wait a bit
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test onboarding endpoint
  await testOnboarding();
  
  console.log('\n═══════════════════════════════════════');
  console.log('  TEST COMPLETE');
  console.log('═══════════════════════════════════════\n');
})();


import clientPromise from '../lib/mongodb.js';

/**
 * Authenticate user by API key and attach user data to request
 * The API key is stored in users.users collection with user's credentials
 */
export async function authenticateRequest(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  
  console.log('🔐 Auth Check:');
  console.log('   API key present:', !!apiKey);
  
  if (!apiKey) {
    console.log('   ❌ No API key provided');
    return res.status(401).json({ error: 'API key required' });
  }
  
  try {
    // Look up user by API key in MongoDB
    const client = await clientPromise;
    const usersDb = client.db('users');
    const usersCollection = usersDb.collection('users');
    
    console.log('   🔍 Looking up user with API key...');
    
    const user = await usersCollection.findOne({ apiKey: apiKey });
    
    if (!user) {
      console.log('   ❌ Invalid API key - user not found');
      return res.status(401).json({ error: 'Invalid API key' });
    }
    
    console.log('   ✅ User authenticated:', user.email);
    console.log('   📋 User platform:', user.platform);
    console.log('   📋 User dbName:', user.dbName);
    
    // Attach user data to request for use in routes
    req.user = {
      email: user.email,
      apiKey: user.apiKey,
      platform: user.platform,
      dbName: user.dbName,
      credentials: user.credentials,
      syncMode: user.syncMode,
      context: user.context,
      explain: user.explain,
      onboardingComplete: user.onboardingComplete,
      trialStatus: user.trialStatus,
      trialStartedAt: user.trialStartedAt
    };
    
    next();
    
  } catch (error) {
    console.error('   ❌ Auth error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}


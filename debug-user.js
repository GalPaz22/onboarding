// Debug script to check user data in MongoDB
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.MONGODB_URI || "mongodb+srv://galpaz2210:HwTqxxAn6XF8xerm@cluster0.qiplrsq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

async function checkUsers() {
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');
    
    const usersDb = client.db('users');
    const usersCollection = usersDb.collection('users');
    
    const users = await usersCollection.find({}).toArray();
    
    console.log(`Found ${users.length} users:\n`);
    
    users.forEach((user, index) => {
      console.log(`User ${index + 1}:`);
      console.log('  Email:', user.email);
      console.log('  API Key:', user.apiKey ? `${user.apiKey.substring(0, 16)}...` : 'MISSING');
      console.log('  dbName:', user.dbName || 'MISSING');
      console.log('  Platform:', user.platform || 'MISSING');
      console.log('  Onboarding Complete:', user.onboardingComplete);
      console.log('  Credentials:', user.credentials ? 'Present' : 'MISSING');
      if (user.credentials) {
        console.log('    - dbName in credentials:', user.credentials.dbName || 'MISSING');
        console.log('    - categories:', user.credentials.categories?.length || 0);
        console.log('    - type:', user.credentials.type?.length || 0);
      }
      console.log('');
    });
    
    if (users.length === 0) {
      console.log('⚠️  No users found. Run onboarding first!');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
  }
}

checkUsers();


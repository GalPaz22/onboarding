import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error('Please add your Mongo URI to .env');
}

// Create a MongoClient with options
const client = new MongoClient(uri, {
  maxPoolSize: 10,
  minPoolSize: 2,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
});

// Create a promise that resolves to the connected client
const clientPromise = client.connect()
  .then(client => {
    console.log('✅ MongoDB connected successfully');
    return client;
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    throw err;
  });

export default clientPromise;


import crypto from 'crypto';

export function authenticateRequest(req, res, next) {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];
  
  // Check for API key in header or query
  const providedKey = apiKey || req.query.api_key;
  const expectedKey = process.env.SERVICE_API_KEY;
  
  if (!providedKey) {
    return res.status(401).json({ error: 'API key required' });
  }
  
  if (!expectedKey) {
    console.error('SERVICE_API_KEY not configured in environment');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  
  // Constant-time comparison to prevent timing attacks
  const providedBuffer = Buffer.from(providedKey);
  const expectedBuffer = Buffer.from(expectedKey);
  
  if (providedBuffer.length !== expectedBuffer.length) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  const isValid = crypto.timingSafeEqual(providedBuffer, expectedBuffer);
  
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  next();
}


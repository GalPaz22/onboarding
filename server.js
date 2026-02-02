import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import onboardingRouter from './routes/onboarding.js';
import reprocessRouter from './routes/reprocess.js';
import healthRouter from './routes/health.js';
import softCategoryAgentRouter from './routes/soft-category-agent.js';
import { authenticateRequest } from './middleware/auth.js';
import initializeScheduler from './lib/scheduler.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy - required for rate limiting behind reverse proxies (Render, Heroku, etc.)
app.set('trust proxy', 1);

// CORS configuration (allow local dev origins + .env overrides)
const defaultAllowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://localhost:5501',
  'http://localhost:5502',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:5501',
  'http://127.0.0.1:5502',
  'https://localhost:3000',
  'https://127.0.0.1:3000',
  'https://www.semantix.co.il',
  'https://semantix-ai.com',
  'https://www.semantix-ai.com'
];

const envAllowed = process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) || [];
const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...envAllowed])];

console.log('🔒 CORS allowed origins:', allowedOrigins);

const corsOptions = {
  origin: function(origin, callback) {
    // Allow requests with no origin (non-browser requests like Postman, curl, server-to-server)
    if (!origin) {
      console.log('✓ CORS: Allowing request with no origin header');
      return callback(null, true);
    }

    // Check if origin is in allowed list or matches localhost pattern
    const isAllowed = allowedOrigins.includes(origin) ||
                      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

    if (isAllowed) {
      console.log(`✓ CORS: Allowing origin: ${origin}`);
      return callback(null, true);
    }

    console.warn(`✗ CORS: Blocking origin: ${origin}`);
    console.warn(`  Allowed origins:`, allowedOrigins);
    return callback(null, false); // Reject with false, not an Error
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Requested-With'],
  exposedHeaders: ['Content-Length', 'Content-Type']
};

app.use(cors(corsOptions));
// Enable preflight across the board
app.options('*', cors(corsOptions));

// Security middleware (applied after CORS to avoid conflicts)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📨 [${timestamp}] ${req.method} ${req.path}`);
  console.log(`   Origin: ${req.headers.origin || 'N/A'}`);
  console.log(`   User-Agent: ${req.headers['user-agent']?.substring(0, 50) || 'N/A'}`);
  console.log(`   API Key: ${req.headers['x-api-key'] ? '✓ Present' : '✗ Missing'}`);
  if (Object.keys(req.query).length > 0) {
    console.log(`   Query:`, req.query);
  }
  console.log(`${'='.repeat(60)}\n`);
  next();
});

// Public routes (no auth required)
app.use('/health', healthRouter);
app.use('/api/onboarding', onboardingRouter); // Onboarding generates API key

// Protected routes (require API key authentication)
app.use('/api/reprocess', authenticateRequest, reprocessRouter);
app.use('/api/soft-category-agent', authenticateRequest, softCategoryAgentRouter);

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    requestId: req.id
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Processing service running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Initialize scheduled tasks
  initializeScheduler();
});


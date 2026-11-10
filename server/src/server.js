import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure server/.env is loaded regardless of working directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

import ticketsRouter from './routes/tickets.js';
import aiRouter from './routes/ai.js';
import nexconnRouter from './routes/nexconn.js';
import knowledgeRouter from './routes/knowledge.js';
import authRouter from './routes/auth.js';
import webhooksRouter from './routes/webhooks.js';
import widgetRouter from './routes/widget.js';
import attachmentsRouter from './routes/attachments.js';
import { healthCheck } from './db/pool.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'App-Key', 'Nonce', 'Timestamp', 'Signature', 'X-CSRF-Token', 'Idempotency-Key', 'X-File-Name', 'X-Ticket-Id', 'X-Brand-Id', 'X-Customer-Id'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// API Routes
app.use('/api/tickets', ticketsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/nexconn', nexconnRouter);
app.use('/api/knowledge', knowledgeRouter);
app.use('/api/auth', authRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/widget', widgetRouter);
app.use('/api/attachments', attachmentsRouter);

// Standalone Embed Widget Loader Script for Host Integration
app.get('/widget.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.resolve(__dirname, '../public/widget.js'));
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const dbHealth = await healthCheck().catch(err => ({ healthy: false, error: err.message }));
  
  // In production, if database is unreachable or missing DATABASE_URL, return 503 Service Unavailable
  if (process.env.NODE_ENV === 'production' && (!dbHealth.healthy || dbHealth.mode !== 'postgresql')) {
    return res.status(503).json({
      status: 'unhealthy',
      service: 'Resolve AI Backend Service',
      database: dbHealth,
      error: 'Production database failure: DATABASE_URL must be configured and connected to PostgreSQL',
      timestamp: new Date().toISOString()
    });
  }

  res.json({
    status: 'ok',
    service: 'Resolve AI Backend Service',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    database: dbHealth,
    environment: {
      hasNexconnKey: Boolean(process.env.NEXCONN_APP_KEY && !process.env.NEXCONN_APP_KEY.includes('your_')),
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes('your_')),
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    }
  });
});

// Root welcome
app.get('/', (req, res) => {
  res.json({
    message: 'Resolve AI API is running. Access customer and agent endpoints under /api.',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ success: false, error: 'Payload too large', message: 'Request entity exceeds payload size limit' });
  }
  console.error('Unhandled server error:', err.message);
  res.status(500).json({ success: false, error: 'Internal Server Error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`Resolve AI Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.DATABASE_URL) {
      console.error(`[PRODUCTION FAIL-CLOSED WARNING] DATABASE_URL is NOT set.`);
      console.error(`[PRODUCTION FAIL-CLOSED WARNING] In-memory and JSON fallbacks are strictly prohibited. Readiness checks will fail.`);
    } else {
      console.log(`[PRODUCTION] Connected to PostgreSQL via DATABASE_URL.`);
    }
  }
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`=========================================`);
});

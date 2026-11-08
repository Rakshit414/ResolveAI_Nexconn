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

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'App-Key', 'Nonce', 'Timestamp', 'Signature'],
}));
app.use(express.json());

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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Resolve AI Backend Service',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: {
      hasNexconnKey: Boolean(process.env.NEXCONN_APP_KEY && !process.env.NEXCONN_APP_KEY.includes('your_')),
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes('your_')),
      hasSupabaseUrl: Boolean(process.env.SUPABASE_URL && !process.env.SUPABASE_URL.includes('your-project')),
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
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`=========================================`);
});

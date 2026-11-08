import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import ticketsRouter from '../src/routes/tickets.js';
import aiRouter from '../src/routes/ai.js';
import nexconnRouter from '../src/routes/nexconn.js';
import knowledgeRouter from '../src/routes/knowledge.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/tickets', ticketsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/nexconn', nexconnRouter);
app.use('/api/knowledge', knowledgeRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Resolve AI Backend Test' });
});

const TEST_PORT = 5055;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function run() {
  const server = app.listen(TEST_PORT, async () => {
    console.log(`\nTest server listening on ${BASE_URL}...`);
    let passed = 0;
    let failed = 0;

    async function check(name, fn) {
      try {
        await fn();
        console.log(`[PASS] ${name}`);
        passed++;
      } catch (e) {
        console.error(`[FAIL] ${name}:`, e.response?.data || e.message);
        failed++;
      }
    }

    try {
      // 1. Health check
      await check('GET /api/health', async () => {
        const res = await axios.get(`${BASE_URL}/api/health`);
        if (res.data.status !== 'ok') throw new Error('status not ok');
      });

      // 2. Nexconn Status
      await check('GET /api/nexconn/status', async () => {
        const res = await axios.get(`${BASE_URL}/api/nexconn/status`);
        if (!res.data.hasAppKey || !res.data.hasAppSecret) throw new Error('Missing keys');
      });

      // 3. Nexconn Token Issuance
      let issuedToken = null;
      await check('POST /api/nexconn/token (Live Nexconn API)', async () => {
        const res = await axios.post(`${BASE_URL}/api/nexconn/token`, {
          userId: 'cust_aarav',
          name: 'Aarav Sharma'
        });
        if (!res.data.success || !res.data.token || res.data.token.length < 30) {
          throw new Error('Token generation failed: ' + JSON.stringify(res.data));
        }
        issuedToken = res.data.token;
        console.log(`       Received live token: ${issuedToken.substring(0, 24)}... (length: ${issuedToken.length})`);
      });

      // 4. AI Classification (Gemini 3.5 Flash)
      await check('POST /api/ai/analyze (Gemini Live)', async () => {
        const res = await axios.post(`${BASE_URL}/api/ai/analyze`, {
          messages: [{ sender: 'Aarav Sharma', text: 'My package is 3 days delayed, where is it?' }],
          customer: { name: 'Aarav Sharma', email: 'aarav@example.com' },
          order: { orderId: 'NC1021', product: 'Running Shoes' }
        });
        if (!res.data.success) throw new Error('Analyze failed');
        console.log(`       Source: ${res.data.source}, Category: ${res.data.data.category}, Priority: ${res.data.data.priority}, Sentiment: ${res.data.data.sentiment}`);
      });

      // 5. AI Summarization (Gemini Live)
      await check('POST /api/ai/summarize (Gemini Live)', async () => {
        const res = await axios.post(`${BASE_URL}/api/ai/summarize`, {
          messages: [{ sender: 'Priya Mehta', text: 'I received the smartwatch but need to return it for a refund.' }],
          customer: { name: 'Priya Mehta', email: 'priya@example.com' },
          order: { orderId: 'NC1022', product: 'NovaWatch Active' }
        });
        if (!res.data.success || !res.data.data.whatHappened || !res.data.data.customerNeeds) {
          throw new Error('Summarize failed');
        }
        console.log(`       Source: ${res.data.source}, Summary: "${res.data.data.whatHappened.substring(0, 60)}..."`);
      });

      // 6. AI Suggest Reply (Gemini Live with Policy Grounding)
      await check('POST /api/ai/suggest-reply (Gemini Live)', async () => {
        const res = await axios.post(`${BASE_URL}/api/ai/suggest-reply`, {
          messages: [{ sender: 'Kabir Verma', text: 'I received the wrong item in my box.' }],
          customer: { name: 'Kabir Verma', email: 'kabir@example.com' },
          order: { orderId: 'NC1023', product: 'Wireless ANC Headphones' }
        });
        if (!res.data.success || !res.data.data.suggestedReply) {
          throw new Error('Suggest reply failed');
        }
        console.log(`       Source: ${res.data.source}, Policies: [${res.data.data.policyReferences?.join(', ')}]`);
        console.log(`       Preview: "${res.data.data.suggestedReply.substring(0, 90)}..."`);
      });

      // 7. Tickets API
      await check('GET /api/tickets', async () => {
        const res = await axios.get(`${BASE_URL}/api/tickets`);
        if (!res.data.tickets || res.data.tickets.length < 3) throw new Error('Tickets incomplete');
      });

      // 8. Human Handoff workflow
      await check('POST /api/tickets/tkt_1021/human-handoff', async () => {
        const res = await axios.post(`${BASE_URL}/api/tickets/tkt_1021/human-handoff`);
        if (res.data.ticket.status !== 'Human Requested') throw new Error('Status not Human Requested');
      });

    } finally {
      server.close(() => {
        console.log(`\n=====================================================`);
        console.log(`E2E SUITE FINISHED: ${passed} PASSED, ${failed} FAILED`);
        console.log(`=====================================================`);
        process.exit(failed > 0 ? 1 : 0);
      });
    }
  });
}

run();

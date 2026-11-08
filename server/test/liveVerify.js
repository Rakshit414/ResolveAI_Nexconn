import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import crypto from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function verifyAllIntegrations() {
  console.log('====================================================');
  console.log('   RESOLVE AI - LIVE BACKEND INTEGRATION TEST       ');
  console.log('====================================================');

  let passed = 0;
  let failed = 0;

  // 1. Verify Gemini API
  console.log('\n--- 1. Testing Gemini API (Model: gemini-3.5-flash) ---');
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    console.error('FAIL: GEMINI_API_KEY is not defined in server/.env');
    failed++;
  } else {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const modelName = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
      const model = genAI.getGenerativeModel({ model: modelName });
      const prompt = 'Respond with JSON only: {"status": "ok", "provider": "gemini", "model": "' + modelName + '"}';
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      console.log('PASS: Gemini response received:');
      console.log(text);
      passed++;
    } catch (e) {
      console.error('FAIL: Gemini call failed:', e.message);
      failed++;
    }
  }

  // 2. Testing Nexconn Access Token Endpoint
  console.log('\n--- 2. Testing Nexconn Access Token Generation ---');
  const appKey = process.env.NEXCONN_APP_KEY;
  const appSecret = process.env.NEXCONN_APP_SECRET;
  const nexconnBaseUrl = process.env.NEXCONN_API_URL || 'https://api.sg-light-api.com';

  if (!appKey || !appSecret) {
    console.error('FAIL: NEXCONN_APP_KEY or NEXCONN_APP_SECRET missing');
    failed++;
  } else {
    try {
      const nonce = Math.floor(Math.random() * 1000000).toString();
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = crypto.createHash('sha1').update(`${appSecret}${nonce}${timestamp}`).digest('hex');

      const url = `${nexconnBaseUrl}/v4/auth/access-token/issue`;
      console.log(`Calling Nexconn URL: ${url}`);

      const res = await axios.post(
        url,
        { userId: 'cust_aarav', name: 'Aarav Sharma' },
        {
          headers: {
            'Content-Type': 'application/json',
            'App-Key': appKey,
            'Nonce': nonce,
            'Timestamp': timestamp,
            'Signature': signature
          },
          timeout: 8000
        }
      );

      console.log(`HTTP Status: ${res.status}`);
      console.log(`Nexconn Code: ${res.data?.code}`);
      const token = res.data?.result?.accessToken;
      if (token) {
        console.log(`PASS: Generated token successfully! (Token length: ${token.length})`);
        console.log(`Token prefix: ${token.substring(0, 20)}...`);
        passed++;
      } else {
        console.error('FAIL: Response data did not contain result.accessToken:', res.data);
        failed++;
      }
    } catch (e) {
      console.error('FAIL: Nexconn token call failed:', e.response?.data || e.message);
      failed++;
    }
  }

  console.log('\n====================================================');
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');
  if (failed > 0) process.exit(1);
}

verifyAllIntegrations();

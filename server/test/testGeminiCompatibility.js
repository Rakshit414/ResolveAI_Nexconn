import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const apiKey = process.env.GEMINI_API_KEY;
console.log('Testing with key present:', Boolean(apiKey && !apiKey.includes('your_')));

if (!apiKey || apiKey.includes('your_')) {
  console.log('No active GEMINI_API_KEY set.');
  process.exit(0);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function callWithTimeout(fn, ms = 8000) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

const candidateModels = [
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite'
];

async function run() {
  for (const m of candidateModels) {
    try {
      const model = genAI.getGenerativeModel({ model: m });
      const res = await callWithTimeout(async () => {
        return await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: 'Respond with: {"status": "ok"}' }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2
          }
        });
      }, 7000);
      console.log(`[PASS] ${m}: Response: ${res.response.text().trim()}`);
    } catch (err) {
      console.log(`[FAIL] ${m}: Error: ${err.message}`);
    }
  }
}

run();

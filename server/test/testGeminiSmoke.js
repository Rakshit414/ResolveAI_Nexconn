import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';

const envFile = fs.readFileSync('server/.env', 'utf8');
const keyMatch = envFile.match(/GEMINI_API_KEY=([^\r\n]+)/);
const key = keyMatch ? keyMatch[1].trim() : '';

const modelName = 'gemini-3.8-flash';
console.log(`[Gemini Smoke Test] Testing model: ${modelName} with GoogleGenerativeAI SDK...`);

const genAI = new GoogleGenerativeAI(key);
const model = genAI.getGenerativeModel({
  model: modelName
});

try {
  const result = await model.generateContent('Translate "Hello, welcome to NovaCart" to Hindi. Return only the translated text.');
  const response = result.response.text();
  console.log('[Gemini Response]:', response.trim());
  console.log(`[Smoke Test Passed]: ${modelName} is supported and operational via GoogleGenerativeAI SDK.`);
} catch (err) {
  console.error('[Gemini API Error]:', err.message);
  process.exit(1);
}

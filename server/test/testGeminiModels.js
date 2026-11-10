import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

async function testModel(modelName) {
  try {
    const start = Date.now();
    const model = genAI.getGenerativeModel({ model: modelName });
    const prompt = 'Translate to Hindi Devanagari: "Your order has been shipped." Respond in JSON with {"translatedText": "..."}';
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    console.log(`[SUCCESS] ${modelName} responded in ${Date.now() - start}ms:`, text.trim());
    return true;
  } catch (err) {
    console.error(`[FAIL] ${modelName}:`, err.message);
    return false;
  }
}

async function main() {
  await testModel('gemini-3.5-flash');
  await testModel('gemini-3.5-flash-lite');
}

main();

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
dotenv.config({ path: path.resolve(__dirname, '../.env') });

console.log('=== [GEMINI API LIVE COMPATIBILITY TEST] ===');

async function testGeminiEndpoints() {
  const TEST_PORT = 5007;
  const proc = spawn('node', ['server/src/server.js'], {
    cwd: ROOT_DIR,
    stdio: 'pipe',
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      GEMINI_MODEL: 'gemini-3.8-flash'
    }
  });

  try {
    let logs = '';
    proc.stdout.on('data', d => logs += d.toString());
    proc.stderr.on('data', d => logs += d.toString());

    // Wait for server ready
    let ready = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 400));
      try {
        const h = await axios.get(`http://127.0.0.1:${TEST_PORT}/api/health`, { timeout: 1000 });
        if (h.status === 200) { ready = true; break; }
      } catch (e) {}
    }

    if (!ready) throw new Error(`Server failed to start: ${logs}`);
    console.log('[PASS] Server booted on port', TEST_PORT);

    // 1. Test /api/ai/analyze
    console.log('\n--- 1. Testing /api/ai/analyze ---');
    const analyzeRes = await axios.post(`http://127.0.0.1:${TEST_PORT}/api/ai/analyze`, {
      messages: [
        { sender: 'Aarav Sharma', text: 'Where is my order NC1021? The tracking status has not updated in 4 days.' }
      ],
      customer: { name: 'Aarav Sharma', email: 'aarav.sharma@example.com' },
      order: { orderId: 'NC1021', product: 'Running Shoes' }
    });

    console.log('[Analyze Status]:', analyzeRes.status);
    console.log('[Analyze Source]:', analyzeRes.data.source);
    console.log('[Analyze Data]:', JSON.stringify(analyzeRes.data.data, null, 2));
    if (analyzeRes.data.source !== 'gemini' && analyzeRes.data.source !== 'fallback') {
      throw new Error('Unexpected analyze response structure');
    }
    console.log('[PASS] /api/ai/analyze responded successfully');

    // 2. Test /api/ai/suggest-reply
    console.log('\n--- 2. Testing /api/ai/suggest-reply ---');
    const suggestRes = await axios.post(`http://127.0.0.1:${TEST_PORT}/api/ai/suggest-reply`, {
      messages: [
        { sender: 'Aarav Sharma', text: 'Hello, my shoes have not arrived yet.' }
      ],
      customer: { name: 'Aarav Sharma', email: 'aarav.sharma@example.com' },
      order: { orderId: 'NC1021', product: 'Running Shoes' }
    });

    console.log('[Suggest Status]:', suggestRes.status);
    console.log('[Suggest Source]:', suggestRes.data.source);
    console.log('[Suggest Reply Preview]:', suggestRes.data.data?.suggestedReply?.substring(0, 100) + '...');
    console.log('[PASS] /api/ai/suggest-reply responded successfully');

    // 3. Test /api/ai/translate
    console.log('\n--- 3. Testing /api/ai/translate ---');
    const transRes = await axios.post(`http://127.0.0.1:${TEST_PORT}/api/ai/translate`, {
      text: 'Track my order',
      targetLanguage: 'hi'
    });

    console.log('[Translate Status]:', transRes.status);
    console.log('[Translate Result]:', transRes.data.translatedText);
    console.log('[PASS] /api/ai/translate responded successfully');

    console.log('\n=================================================');
    console.log('ALL GEMINI API INTEGRATION TESTS PASSED');
    console.log('=================================================');
  } finally {
    proc.kill('SIGTERM');
  }
}

testGeminiEndpoints().catch(err => {
  console.error('[GEMINI TEST FAILED]:', err.message);
  process.exit(1);
});

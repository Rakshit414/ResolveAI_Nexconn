import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

async function testRoutes() {
  const TEST_PORT = 5005;
  console.log(`Starting server on port ${TEST_PORT} to test production routing...`);

  const proc = spawn('node', ['server/src/server.js'], {
    cwd: ROOT_DIR,
    stdio: 'pipe',
    env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: 'test' }
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
      } catch (e) {
        // waiting for port bind
      }
    }

    if (!ready) {
      throw new Error(`Server failed to boot: ${logs}`);
    }

    console.log('[PASS] /api/health returned 200 OK');

    // Test frontend routes
    const routes = ['/', '/store', '/customer', '/agent', '/split', '/widget-frame'];
    for (const route of routes) {
      const res = await axios.get(`http://127.0.0.1:${TEST_PORT}${route}`);
      if (res.status !== 200 || !res.data.includes('<!doctype html>') && !res.data.includes('<html')) {
        throw new Error(`Route ${route} failed to return HTML index! Status: ${res.status}`);
      }
      console.log(`[PASS] Route ${route} successfully returned SPA HTML`);
    }

    // Test widget.js
    const widgetRes = await axios.get(`http://127.0.0.1:${TEST_PORT}/widget.js`);
    if (widgetRes.status !== 200 || !widgetRes.headers['content-type'].includes('javascript')) {
      throw new Error(`Route /widget.js failed! Status: ${widgetRes.status}`);
    }
    console.log('[PASS] Route /widget.js successfully returned JavaScript');

    // Test 404 on API route
    try {
      await axios.get(`http://127.0.0.1:${TEST_PORT}/api/nonexistent-route-404`);
      throw new Error('Expected 404 for /api/nonexistent-route-404');
    } catch (err) {
      if (err.response && err.response.status === 404) {
        console.log('[PASS] Unmatched /api/* route correctly returned HTTP 404');
      } else {
        throw err;
      }
    }

    console.log('\n=== ALL ROUTE TESTS PASSED SUCCESSFULLY ===');
  } finally {
    proc.kill('SIGTERM');
  }
}

testRoutes().catch(err => {
  console.error('[ROUTE TEST FAILED]:', err);
  process.exit(1);
});

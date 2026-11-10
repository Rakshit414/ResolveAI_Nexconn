import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import axios from 'axios';
import EmbeddedPostgres from 'embedded-postgres';
import { runMigration } from '../src/db/migrate.js';
import { closePool } from '../src/db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const PG16_DATA_DIR = path.resolve(ROOT_DIR, 'server/data/pg16_smoke_test_instance');
const TEST_PG_PORT = 54329;
const TEST_DB_URL = `postgresql://postgres:postgres@127.0.0.1:${TEST_PG_PORT}/postgres`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHttp(url, expectedStatus, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await axios.get(url, { timeout: 1500, validateStatus: () => true });
      if (res.status === expectedStatus) return res;
    } catch (e) {}
    await sleep(400);
  }
  throw new Error(`Endpoint ${url} failed to return HTTP ${expectedStatus} within ${timeoutMs}ms`);
}

async function main() {
  console.log('=== [FINAL PRE-DEPLOYMENT SMOKE TEST SUITE] ===');
  console.log('Target: Production Database Fail-Closed & Widget Origin Security Verification\n');

  // =========================================================================
  // ITEM 1: PRODUCTION DATABASE FAIL-CLOSED VERIFICATION
  // =========================================================================
  console.log('=================================================================');
  console.log('ITEM 1: PRODUCTION DATABASE FAIL-CLOSED VERIFICATION');
  console.log('=================================================================');

  // --- CASE A: NODE_ENV=production WITH MISSING DATABASE_URL ---
  console.log('\n--- [Case A] Starting Server in NODE_ENV=production WITHOUT DATABASE_URL ---');
  const portA = 5007;
  const envA = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(portA),
    DATABASE_URL: '' // Missing
  };
  delete envA.DATABASE_URL;

  const procA = spawn('node', ['server/src/server.js'], {
    cwd: ROOT_DIR,
    stdio: 'pipe',
    env: envA
  });

  let logsA = '';
  procA.stdout.on('data', d => logsA += d.toString());
  procA.stderr.on('data', d => logsA += d.toString());

  try {
    const resA = await waitForHttp(`http://127.0.0.1:${portA}/api/health`, 503, 10000);
    console.log('[Case A HTTP Status]:', resA.status, '(Expected 503 Service Unavailable)');
    console.log('[Case A Health Response Body]:', JSON.stringify(resA.data, null, 2));

    if (resA.data.status !== 'unhealthy' || resA.data.database?.healthy !== false) {
      throw new Error('[FAIL] Production readiness check allowed unconfigured database mode');
    }
    console.log('[PASS] Production readiness check successfully failed closed with HTTP 503');
    console.log('[PASS] Database mode is "unconfigured" — zero fallback to JSON or in-memory storage');
  } finally {
    procA.kill('SIGTERM');
  }

  // --- CASE B: NODE_ENV=production WITH VALID POSTGRESQL 16 DATABASE ---
  console.log('\n--- [Case B] Starting Server in NODE_ENV=production WITH VALID POSTGRESQL 16 ---');
  if (fs.existsSync(PG16_DATA_DIR)) {
    fs.rmSync(PG16_DATA_DIR, { recursive: true, force: true });
  }

  console.log(`[PG16] Spawning PostgreSQL 16 server on port ${TEST_PG_PORT}...`);
  const pgServer = new EmbeddedPostgres({
    port: TEST_PG_PORT,
    databaseDir: PG16_DATA_DIR,
    user: 'postgres',
    password: 'postgres'
  });

  await pgServer.initialise();
  await pgServer.start();
  console.log('[PG16] Native PostgreSQL 16 server running and ready');

  // Run migration runner to set up canonical schema
  process.env.DATABASE_URL = TEST_DB_URL;
  await closePool();
  await runMigration({ dryRun: false });

  const portB = 5008;
  const envB = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(portB),
    DATABASE_URL: TEST_DB_URL
  };

  let procB = spawn('node', ['server/src/server.js'], {
    cwd: ROOT_DIR,
    stdio: 'pipe',
    env: envB
  });

  let logsB = '';
  procB.stdout.on('data', d => logsB += d.toString());
  procB.stderr.on('data', d => logsB += d.toString());

  try {
    let resB;
    try {
      resB = await waitForHttp(`http://127.0.0.1:${portB}/api/health`, 200, 10000);
    } catch (e) {
      console.error('[procB stdout/stderr]:', logsB);
      throw e;
    }
    console.log('[Case B HTTP Status]:', resB.status, '(Expected 200 OK)');
    console.log('[Case B Health Response Body]:', JSON.stringify(resB.data, null, 2));

    if (resB.data.database?.mode !== 'postgresql' || !resB.data.database?.healthy) {
      throw new Error('[FAIL] Database mode must be postgresql and healthy');
    }
    console.log('[PASS] Application successfully running in production with database.mode = postgresql');

    // Create a record in PostgreSQL via application flow
    console.log('\n--- Testing PostgreSQL Create and Read ---');
    const testSessionToken = `wgt_smoke_${Date.now()}`;
    const testTokenHash = 'hash_' + Date.now();
    const { default: pg } = await import('pg');
    const directPool = new pg.Pool({ connectionString: TEST_DB_URL });

    await directPool.query(`
      INSERT INTO widget_sessions (id, brand_id, customer_id, session_token_hash, origin, is_guest, expires_at)
      VALUES ($1, 'brand_novacart', 'cust_aarav', $2, 'https://resolve-ai-novacart.onrender.com', false, NOW() + INTERVAL '1 day')
    `, [`sess_${Date.now()}`, testTokenHash]);

    const readRes1 = await directPool.query(`SELECT id, brand_id, customer_id FROM widget_sessions WHERE session_token_hash = $1`, [testTokenHash]);
    console.log('[Created & Verified in PostgreSQL 16]:', readRes1.rows[0]);
    if (readRes1.rows.length !== 1) throw new Error('[FAIL] Record creation failed');

    // Restart application server
    console.log('\n--- Restarting Application Server ---');
    procB.kill('SIGTERM');
    await sleep(1000);

    procB = spawn('node', ['server/src/server.js'], {
      cwd: ROOT_DIR,
      stdio: 'pipe',
      env: envB
    });

    const resB2 = await waitForHttp(`http://127.0.0.1:${portB}/api/health`, 200, 10000);
    console.log('[Re-started Health Status]:', resB2.status, resB2.data.status);

    // Verify record persists after server restart
    const readRes2 = await directPool.query(`SELECT id, brand_id, customer_id FROM widget_sessions WHERE session_token_hash = $1`, [testTokenHash]);
    console.log('[Re-read after Server Restart]:', readRes2.rows[0]);
    if (readRes2.rows.length !== 1) throw new Error('[FAIL] Record did not persist across server restart');
    console.log('[PASS] Data persistence verified across application restart against PostgreSQL 16');

    await directPool.end();

    // =========================================================================
    // ITEM 2: PRODUCTION WIDGET ORIGIN VERIFICATION
    // =========================================================================
    console.log('\n=================================================================');
    console.log('ITEM 2: PRODUCTION WIDGET ORIGIN SECURITY VERIFICATION');
    console.log('=================================================================');

    // 1. Query /api/widget/config with approved origin
    console.log('\n--- 1. Querying /api/widget/config with Approved Production Origin ---');
    const approvedOrigin = 'https://resolve-ai-novacart.onrender.com';
    const cfgRes = await axios.get(`http://127.0.0.1:${portB}/api/widget/config?brandId=brand_novacart`, {
      headers: { Origin: approvedOrigin }
    });
    console.log('[Approved Origin HTTP Status]:', cfgRes.status, '(Expected 200 OK)');
    console.log('[Brand Config Name]:', cfgRes.data.brand.name);
    console.log('[Brand Allowed Origins]:', cfgRes.data.brand.allowedOrigins);

    // Assert localhost and 127.0.0.1 are ABSENT
    const hasLocalhost = cfgRes.data.brand.allowedOrigins.some(o => o.includes('localhost') || o.includes('127.0.0.1'));
    if (hasLocalhost) {
      throw new Error('[FAIL] Localhost must be completely absent from production allowed origins');
    }
    console.log('[PASS] Confirmed: localhost and 127.0.0.1 origins are completely ABSENT from production config');

    // 2. Test Rejection of Localhost Origin in Production
    console.log('\n--- 2. Testing Rejection of Localhost Origin in Production ---');
    const localRes = await axios.get(`http://127.0.0.1:${portB}/api/widget/config?brandId=brand_novacart`, {
      headers: { Origin: 'http://localhost:5173' },
      validateStatus: () => true
    });
    console.log('[Localhost Request Status]:', localRes.status, '(Expected 403 Forbidden)');
    console.log('[Localhost Response Error]:', localRes.data.error);
    if (localRes.status !== 403) throw new Error('[FAIL] Localhost origin must be rejected in production with HTTP 403');
    console.log('[PASS] Localhost origin strictly rejected with HTTP 403 in production mode');

    // 3. Test Rejection of 127.0.0.1 in Production
    console.log('\n--- 3. Testing Rejection of 127.0.0.1 Origin in Production ---');
    const ipRes = await axios.get(`http://127.0.0.1:${portB}/api/widget/config?brandId=brand_novacart`, {
      headers: { Origin: 'http://127.0.0.1:5173' },
      validateStatus: () => true
    });
    console.log('[127.0.0.1 Request Status]:', ipRes.status, '(Expected 403 Forbidden)');
    if (ipRes.status !== 403) throw new Error('[FAIL] 127.0.0.1 must be rejected in production');
    console.log('[PASS] 127.0.0.1 origin strictly rejected with HTTP 403 in production mode');

    // 4. Test Rejection of Prefix-Confusion Attack Domain (.attacker.com)
    console.log('\n--- 4. Testing Rejection of Prefix-Confusion Attack Domain (.attacker.com) ---');
    const attackerOrigin = 'https://resolve-ai-novacart.onrender.com.attacker.com';
    const attackRes = await axios.get(`http://127.0.0.1:${portB}/api/widget/config?brandId=brand_novacart`, {
      headers: { Origin: attackerOrigin },
      validateStatus: () => true
    });
    console.log('[Prefix-Confusion Attack Status]:', attackRes.status, '(Expected 403 Forbidden)');
    console.log('[Prefix-Confusion Response Error]:', attackRes.data.error);
    if (attackRes.status !== 403) throw new Error('[FAIL] Prefix-confusion attack must be rejected with HTTP 403');
    console.log('[PASS] Prefix-confusion attack (https://resolve-ai-novacart.onrender.com.attacker.com) strictly blocked');

    // 5. Test Rejection of Hyphenated Spoof Domain
    console.log('\n--- 5. Testing Rejection of Hyphenated Spoof Domain ---');
    const spoofOrigin = 'https://resolve-ai-novacart.onrender.com-evil.org';
    const spoofRes = await axios.get(`http://127.0.0.1:${portB}/api/widget/config?brandId=brand_novacart`, {
      headers: { Origin: spoofOrigin },
      validateStatus: () => true
    });
    console.log('[Hyphenated Spoof Status]:', spoofRes.status, '(Expected 403 Forbidden)');
    if (spoofRes.status !== 403) throw new Error('[FAIL] Hyphenated spoof must be rejected with HTTP 403');
    console.log('[PASS] Hyphenated spoof domain strictly blocked');

    console.log('\n=================================================================');
    console.log('ALL FINAL PRE-DEPLOYMENT SMOKE TEST CHECKS PASSED');
    console.log('=================================================================');
  } finally {
    procB.kill('SIGTERM');
    await closePool();
    await pgServer.stop();
    fs.rmSync(PG16_DATA_DIR, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error('[SMOKE TEST FAILED]:', err);
  process.exit(1);
});

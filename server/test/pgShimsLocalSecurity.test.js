// server/test/pgShimsLocalSecurity.test.js
import assert from 'assert';
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const PG_DUMP_SHIM = path.join(ROOT_DIR, 'server/scripts/pgDumpShim.js');
const PG_RESTORE_SHIM = path.join(ROOT_DIR, 'server/scripts/pgRestoreShim.js');

console.log('================================================================================');
console.log('=== [TEST SUITE: PostgreSQL Helper Shims Local-Only Security Audit] ===');
console.log('================================================================================\n');

// 1. Source code audit: confirm rejectUnauthorized: false is completely removed
console.log('--- TEST 1: Source Code Audit — rejectUnauthorized Completely Removed ---');
const dumpSource = fs.readFileSync(PG_DUMP_SHIM, 'utf8');
const restoreSource = fs.readFileSync(PG_RESTORE_SHIM, 'utf8');

assert.strictEqual(
  dumpSource.includes('rejectUnauthorized'),
  false,
  'pgDumpShim.js must not contain rejectUnauthorized'
);
assert.strictEqual(
  restoreSource.includes('rejectUnauthorized'),
  false,
  'pgRestoreShim.js must not contain rejectUnauthorized'
);
assert.strictEqual(
  dumpSource.includes('ssl: false'),
  true,
  'pgDumpShim.js must explicitly set ssl: false'
);
assert.strictEqual(
  restoreSource.includes('ssl: false'),
  true,
  'pgRestoreShim.js must explicitly set ssl: false'
);
console.log('[PASS] Test 1: Source code contains zero rejectUnauthorized occurrences and sets ssl: false.\n');

// Helper to run node CLI script and capture result
function runShim(scriptPath, args = [], envVars = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT_DIR,
    env: { ...process.env, ...envVars },
    encoding: 'utf8'
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

// 2. pgDumpShim: Reject remote DATABASE_URL
console.log('--- TEST 2: pgDumpShim Remote Host Rejection ---');
const remoteUrls = [
  'postgresql://user:password@dpg-prod-12345.render.com:5432/prod_db',
  'postgresql://user:password@192.168.1.100:5432/db',
  'postgresql://user:password@10.0.0.5:5432/db',
  'postgresql://user:password@0.0.0.0:5432/db',
  'postgresql://user:password@localhost.attacker.com:5432/db',
  'postgres://user:password@remote-postgres.internal:5432/db'
];

const dummyDumpFile = path.join(ROOT_DIR, 'server/data/dummy_test.dump');

for (const remoteUrl of remoteUrls) {
  // Test via DATABASE_URL env var
  const envRes = runShim(PG_DUMP_SHIM, ['-f', dummyDumpFile], { DATABASE_URL: remoteUrl });
  assert.strictEqual(envRes.status, 1, `pg_dump must exit with code 1 for remote DATABASE_URL: ${remoteUrl}`);
  assert.strictEqual(
    envRes.stderr.includes('Remote connection rejected'),
    true,
    `Stderr must report remote rejection for ${remoteUrl}`
  );
  assert.strictEqual(
    envRes.stderr.includes('Only local connections (localhost, 127.0.0.1, ::1) are allowed'),
    true,
    `Stderr must cite local-only policy for ${remoteUrl}`
  );

  // Test via connection URL command line argument
  const argRes = runShim(PG_DUMP_SHIM, ['-f', dummyDumpFile, remoteUrl], { DATABASE_URL: '' });
  assert.strictEqual(argRes.status, 1, `pg_dump must exit with code 1 for remote CLI argument: ${remoteUrl}`);
  assert.strictEqual(argRes.stderr.includes('Remote connection rejected'), true);
}

// Test via -h remote flag
const flagRes = runShim(
  PG_DUMP_SHIM,
  ['-f', dummyDumpFile, '-h', 'external.database.cloud'],
  { DATABASE_URL: 'postgresql://postgres:password@localhost:5432/postgres' }
);
assert.strictEqual(flagRes.status, 1);
assert.strictEqual(flagRes.stderr.includes('Remote connection rejected'), true);

console.log('[PASS] Test 2: pgDumpShim rejected all remote hostnames and IPs immediately with exit code 1.\n');

// 3. pgRestoreShim: Reject remote connection parameters
console.log('--- TEST 3: pgRestoreShim Remote Host Rejection ---');
const dummyArchiveFile = path.join(ROOT_DIR, 'server/data/dummy_archive.dump');
fs.writeFileSync(dummyArchiveFile, '-- PostgreSQL database dump\n-- Data for Name: brands; Type: TABLE DATA; Schema: public; Owner: postgres\n', 'utf8');

try {
  // Test via -h remote host
  const remoteHosts = [
    'dpg-prod-restore.render.com',
    '192.168.1.50',
    '10.200.1.1',
    '0.0.0.0',
    'evil-host.localhost.me'
  ];

  for (const rHost of remoteHosts) {
    const res = runShim(PG_RESTORE_SHIM, ['-h', rHost, '-d', 'postgres', dummyArchiveFile], { DATABASE_URL: '' });
    assert.strictEqual(res.status, 1, `pg_restore must exit with code 1 for remote -h host: ${rHost}`);
    assert.strictEqual(
      res.stderr.includes('Remote connection rejected'),
      true,
      `Stderr must report remote rejection for -h ${rHost}`
    );
    assert.strictEqual(
      res.stderr.includes('Only local connections (localhost, 127.0.0.1, ::1) are allowed'),
      true
    );
  }

  // Test via remote DATABASE_URL
  const restoreEnvRes = runShim(
    PG_RESTORE_SHIM,
    [dummyArchiveFile],
    { DATABASE_URL: 'postgresql://postgres:password@remote.postgres.database:5432/db' }
  );
  assert.strictEqual(restoreEnvRes.status, 1);
  assert.strictEqual(restoreEnvRes.stderr.includes('Remote connection rejected'), true);

  console.log('[PASS] Test 3: pgRestoreShim rejected all remote target hosts immediately with exit code 1.\n');

  // 4. pgRestoreShim: --list remains local & succeeds without connecting to DB
  console.log('--- TEST 4: pgRestoreShim --list Mode Operates Exclusively on Local File ---');
  const listRes = runShim(PG_RESTORE_SHIM, ['--list', dummyArchiveFile]);
  assert.strictEqual(listRes.status, 0, 'pg_restore --list must exit with code 0');
  assert.strictEqual(listRes.stdout.includes('TABLE DATA public brands postgres'), true);
  console.log('[PASS] Test 4: pg_restore --list parsed archive file locally without database connection.\n');

  // 5. Permitted local connection host validation passes
  console.log('--- TEST 5: Permitted Local Hosts Validation (localhost, 127.0.0.1, ::1) ---');
  const localHosts = ['localhost', '127.0.0.1', '::1', '[::1]'];

  for (const lHost of localHosts) {
    // When attempting to connect to a local port that is closed, it passes host validation and fails with connection refused
    const localRes = runShim(
      PG_DUMP_SHIM,
      ['-f', dummyDumpFile],
      { DATABASE_URL: `postgresql://postgres:password@${lHost}:65500/postgres` }
    );
    // Must NOT be rejected by the security validator
    assert.strictEqual(
      localRes.stderr.includes('Remote connection rejected'),
      false,
      `Local host ${lHost} must not be rejected by security validator`
    );
  }
  console.log('[PASS] Test 5: Local hosts (localhost, 127.0.0.1, ::1) are permitted by security validator.\n');

} finally {
  try { if (fs.existsSync(dummyDumpFile)) fs.unlinkSync(dummyDumpFile); } catch (e) {}
  try { if (fs.existsSync(dummyArchiveFile)) fs.unlinkSync(dummyArchiveFile); } catch (e) {}
}

console.log('================================================================================');
console.log('=== [ALL POSTGRESQL SHIM SECURITY AUDIT TESTS PASSED] ===');
console.log('================================================================================');

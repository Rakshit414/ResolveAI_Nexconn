import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

console.log('=== [TEST SUITE 16: Render Build & Start Command Verification] ===');

async function testRenderBuildAndStart() {
  const isWindows = process.platform === 'win32';
  const npmCmd = isWindows ? 'npm.cmd' : 'npm';

  // 1. Inspect package manifests
  console.log('\n--- 1. Inspecting Package Manifests ---');
  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  const serverPkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'server/package.json'), 'utf8'));
  const clientPkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'client/package.json'), 'utf8'));

  console.log('Root build script:', rootPkg.scripts?.build);
  console.log('Root start script:', rootPkg.scripts?.start);
  console.log('Server dependencies count:', Object.keys(serverPkg.dependencies || {}).length);
  console.log('Client dependencies count:', Object.keys(clientPkg.dependencies || {}).length);

  // 2. Test exact Render build command
  console.log('\n--- 2. Executing Render Build Command ---');
  const buildCmd = `${npmCmd} --prefix server install && ${npmCmd} --prefix client install && ${npmCmd} --prefix client run build`;
  console.log('[Executing]:', buildCmd);

  const buildOutput = execSync(buildCmd, { cwd: ROOT_DIR, stdio: 'pipe' }).toString();
  console.log('[Build Output Summary]:\n', buildOutput.split('\n').filter(l => l.includes('built in') || l.includes('dist/assets') || l.includes('audited')).join('\n'));

  const distHtml = path.join(ROOT_DIR, 'client/dist/index.html');
  if (!fs.existsSync(distHtml)) {
    throw new Error('Build artifact client/dist/index.html does not exist after build');
  }
  console.log('[PASS] Build artifact client/dist/index.html successfully produced');

  // Verify server production dependencies
  const expressPkg = path.join(ROOT_DIR, 'server/node_modules/express/package.json');
  const pgPkg = path.join(ROOT_DIR, 'server/node_modules/pg/package.json');
  if (!fs.existsSync(expressPkg) || !fs.existsSync(pgPkg)) {
    throw new Error('Server dependencies missing from server/node_modules');
  }
  console.log('[PASS] Verified essential production server dependencies (express, pg) in server/node_modules');

  // 3. Test exact Render start command
  console.log('\n--- 3. Executing Render Start Command & Health Check ---');
  const TEST_PORT = 5005;
  const startProc = spawn('node', ['server/src/server.js'], {
    cwd: ROOT_DIR,
    stdio: 'pipe',
    env: { ...process.env, PORT: String(TEST_PORT) }
  });

  try {
    let serverLogs = '';
    startProc.stdout.on('data', d => serverLogs += d.toString());
    startProc.stderr.on('data', d => serverLogs += d.toString());

    // Wait for server to bind port
    let isHealthy = false;
    let healthData = null;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      try {
        const res = await axios.get(`http://127.0.0.1:${TEST_PORT}/api/health`, { timeout: 1500 });
        if (res.status === 200) {
          isHealthy = true;
          healthData = res.data;
          break;
        }
      } catch (e) {}
    }

    if (!isHealthy) {
      throw new Error(`Server failed to respond to /api/health on port ${TEST_PORT}. Logs: ${serverLogs}`);
    }

    console.log('[Health Check Response Status]: 200 OK');
    console.log('[Health Check Response Body]:', JSON.stringify(healthData, null, 2));
    console.log('[PASS] Render start command successfully executed and passed health check');

    console.log('\n====================================================================');
    console.log('ALL RENDER BUILD & START COMMAND CHECKS PASSED');
    console.log('====================================================================');
  } finally {
    startProc.kill('SIGTERM');
  }
}

testRenderBuildAndStart().catch(err => {
  console.error('[FAILED]:', err);
  process.exit(1);
});

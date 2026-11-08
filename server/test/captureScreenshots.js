import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BACKEND_URL = 'http://127.0.0.1:5000';
const FRONTEND_URL = 'http://127.0.0.1:5173';

const ARTIFACT_DIR = 'C:/Users/Rakshit Jain/.gemini/antigravity/brain/4f19604b-ba21-48f5-8507-572a2a9548c7';
const ARTIFACT_SCREENSHOTS = path.join(ARTIFACT_DIR, 'screenshots');
const LOCAL_SCREENSHOTS = path.join(ROOT_DIR, 'screenshots');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await axios.get(url, { timeout: 2000 });
      if (res.status === 200 || res.status === 304) return true;
    } catch (e) {
      // wait and retry
    }
    await sleep(500);
  }
  throw new Error(`Server at ${url} failed to respond within ${timeoutMs}ms`);
}

async function ensureServers() {
  const processes = [];

  const backendAlive = await axios.get(`${BACKEND_URL}/api/health`, { timeout: 1000 }).then(() => true).catch(() => false);
  if (!backendAlive) {
    console.log('[Step 1] Spawning Express Backend server...');
    const backendProc = spawn('node', ['server/src/server.js'], {
      cwd: ROOT_DIR,
      stdio: 'pipe',
      env: { ...process.env, PORT: '5000' }
    });
    processes.push(backendProc);
  } else {
    console.log('[Step 1] Backend server already running.');
  }

  const frontendAlive = await axios.get(FRONTEND_URL, { timeout: 1000 }).then(() => true).catch(() => false);
  if (!frontendAlive) {
    console.log('[Step 2] Spawning Vite Frontend server...');
    const frontendProc = spawn('node', ['./node_modules/vite/bin/vite.js', 'preview', '--port', '5173', '--host', '127.0.0.1'], {
      cwd: path.resolve(ROOT_DIR, 'client'),
      stdio: 'pipe'
    });
    processes.push(frontendProc);
  } else {
    console.log('[Step 2] Frontend server already running.');
  }

  await waitForServer(`${BACKEND_URL}/api/health`, 20000);
  console.log(' -> Backend is READY at', BACKEND_URL);
  await waitForServer(FRONTEND_URL, 20000);
  console.log(' -> Frontend is READY at', FRONTEND_URL);

  return processes;
}

async function main() {
  fs.mkdirSync(ARTIFACT_SCREENSHOTS, { recursive: true });
  fs.mkdirSync(LOCAL_SCREENSHOTS, { recursive: true });

  const processes = await ensureServers();

  console.log('Launching Chrome to capture screenshots...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });

  try {
    const page = await browser.newPage();

    async function takeScreenshot(name) {
      const artPath = path.join(ARTIFACT_SCREENSHOTS, name);
      const locPath = path.join(LOCAL_SCREENSHOTS, name);
      await page.screenshot({ path: artPath, fullPage: false });
      fs.copyFileSync(artPath, locPath);
      console.log(`✓ Saved: ${name}`);
    }

    // 1. Split View (1536 x 864) - Copilot Closed
    console.log('\n--- 1. Split View at 1536 x 864 (Copilot Closed) ---');
    await page.setViewport({ width: 1536, height: 864, deviceScaleFactor: 1 });
    await page.goto(`${FRONTEND_URL}/split`, { waitUntil: 'networkidle0' });
    await sleep(1500);
    await takeScreenshot('01_split_view_copilot_closed_1536x864.png');

    // 2. Split View (1536 x 864) - Copilot Open
    console.log('\n--- 2. Split View at 1536 x 864 (Copilot Open) ---');
    await page.evaluate(() => {
      const btn = document.querySelector('#btn-toggle-copilot');
      if (btn) btn.click();
    });
    await sleep(1200);
    await takeScreenshot('02_split_view_copilot_open_1536x864.png');

    // 3. Split View (1440 x 900) - Copilot Closed
    console.log('\n--- 3. Split View at 1440 x 900 (Copilot Closed) ---');
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(`${FRONTEND_URL}/split`, { waitUntil: 'networkidle0' });
    await sleep(1200);
    await takeScreenshot('03_split_view_copilot_closed_1440x900.png');

    // 4. Split View (1440 x 900) - Copilot Open
    console.log('\n--- 4. Split View at 1440 x 900 (Copilot Open) ---');
    await page.evaluate(() => {
      const btn = document.querySelector('#btn-toggle-copilot');
      if (btn) btn.click();
    });
    await sleep(1200);
    await takeScreenshot('04_split_view_copilot_open_1440x900.png');

    // 5. Agent Dashboard (1536 x 864) - Copilot Closed
    console.log('\n--- 5. Agent Dashboard at 1536 x 864 (Copilot Closed) ---');
    await page.setViewport({ width: 1536, height: 864, deviceScaleFactor: 1 });
    await page.goto(`${FRONTEND_URL}/agent`, { waitUntil: 'networkidle0' });
    await sleep(1200);
    await takeScreenshot('06_agent_dashboard_copilot_closed_1536x864.png');

    // 6. Agent Dashboard (1536 x 864) - Copilot Open
    console.log('\n--- 6. Agent Dashboard at 1536 x 864 (Copilot Open) ---');
    await page.evaluate(() => {
      const btn = document.querySelector('#btn-toggle-copilot');
      if (btn) btn.click();
    });
    await sleep(1200);
    await takeScreenshot('05_agent_dashboard_copilot_open_1536x864.png');

    // 7. Customer Portal Desktop (1536 x 864)
    console.log('\n--- 7. Customer Portal Desktop at 1536 x 864 ---');
    await page.goto(`${FRONTEND_URL}/customer`, { waitUntil: 'networkidle0' });
    await sleep(1200);
    await takeScreenshot('07_customer_portal_desktop_1536x864.png');

    // 8. Tablet View (768 x 1024)
    console.log('\n--- 8. Tablet View (768 x 1024) ---');
    await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 1 });
    await page.goto(`${FRONTEND_URL}/split`, { waitUntil: 'networkidle0' });
    await sleep(1200);
    await takeScreenshot('08_tablet_view_768x1024.png');

    // 9. Mobile View (375 x 812) - Chat
    console.log('\n--- 9. Mobile View (375 x 812) - Chat ---');
    await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 });
    await page.goto(`${FRONTEND_URL}/agent`, { waitUntil: 'networkidle0' });
    await sleep(1200);
    await takeScreenshot('09_mobile_agent_chat_375x812.png');

    // 10. Mobile View - Inbox Tab
    console.log('\n--- 10. Mobile View - Inbox Tab ---');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const inboxBtn = btns.find(b => b.textContent.includes('Inbox'));
      if (inboxBtn) inboxBtn.click();
    });
    await sleep(800);
    await takeScreenshot('10_mobile_agent_inbox_375x812.png');

    // 11. Mobile View - Copilot Tab
    console.log('\n--- 11. Mobile View - Copilot Tab ---');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const copilotTab = btns.find(b => b.textContent.includes('Copilot'));
      if (copilotTab) copilotTab.click();
    });
    await sleep(800);
    await takeScreenshot('11_mobile_agent_copilot_375x812.png');

    // 12. Customer Portal Mobile
    console.log('\n--- 12. Customer Portal Mobile ---');
    await page.goto(`${FRONTEND_URL}/customer`, { waitUntil: 'networkidle0' });
    await sleep(1000);
    await takeScreenshot('12_customer_portal_mobile_375x812.png');

    console.log('\n========================================');
    console.log('All 12 Screenshots Captured Successfully!');
    console.log('========================================\n');
  } finally {
    await browser.close();
    for (const p of processes) {
      try {
        p.kill();
      } catch (e) {}
    }
  }
}

main().catch(err => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});

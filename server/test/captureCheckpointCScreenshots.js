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

  console.log('Launching Chrome to capture Checkpoint C screenshots...');
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
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

    async function takeScreenshot(name) {
      const artPath = path.join(ARTIFACT_SCREENSHOTS, name);
      const locPath = path.join(LOCAL_SCREENSHOTS, name);
      await page.screenshot({ path: artPath, fullPage: false });
      try { fs.copyFileSync(artPath, locPath); } catch (e) {}
      console.log(`✓ Saved: ${name}`);
    }

    // 1. Desktop Finished Storefront with Closed Launcher
    console.log('\n[1/6] Capturing Desktop NovaCart Storefront with Closed Floating Launcher...');
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(`${FRONTEND_URL}/store`, { waitUntil: 'networkidle0' });
    await sleep(2000);

    const pageInfo = await page.evaluate(() => ({
      title: document.title,
      bodyTextLength: document.body.innerText.length,
      sample: document.body.innerText.slice(0, 200)
    }));
    console.log('Page Info on /store:', pageInfo);

    await takeScreenshot('novacart_storefront_desktop.png');

    // 2. Focused view of the closed launcher with order prompt teaser
    console.log('[2/6] Capturing Closed Widget Floating Launcher with teaser badge...');
    await takeScreenshot('widget_closed_launcher.png');

    // 3. Open Widget Conversation View (Aarav Sharma - Order NC1021)
    console.log('[3/6] Capturing Open Widget Conversation with Aarav Sharma & Support Actions...');
    await page.evaluate(() => {
      // Find and click the floating widget button
      const floatingBtn = document.querySelector('button[aria-label="Open NovaCart Support Chat"]');
      if (floatingBtn) {
        floatingBtn.click();
      } else {
        // Fallback: click any button containing "Ask Support AI"
        const btns = Array.from(document.querySelectorAll('button'));
        const askBtn = btns.find(b => b.textContent.includes('Ask Support AI') || b.textContent.includes('Launch Support'));
        if (askBtn) askBtn.click();
      }
    });
    await sleep(1500);
    await takeScreenshot('widget_open_conversation.png');

    // 4. Embed Snippet & Brand Theming Modal
    console.log('[4/6] Capturing Embed Snippet & Brand Theming Modal...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const embedBtn = btns.find(b => b.textContent.includes('Embed Widget Snippet') || b.textContent.includes('View Script Snippet'));
      if (embedBtn) embedBtn.click();
    });
    await sleep(1000);
    await takeScreenshot('widget_embed_modal.png');

    // Close modal
    await page.evaluate(() => {
      const closeBtn = document.querySelector('button svg.lucide-x')?.parentElement;
      if (closeBtn) closeBtn.click();
    });
    await sleep(500);

    // 5. Agent Dashboard Interaction View
    console.log('[5/6] Capturing Agent Dashboard Interaction with Sarah Lin...');
    await page.goto(`${FRONTEND_URL}/agent?ticket=tkt_1021`, { waitUntil: 'networkidle0' });
    await sleep(2000);
    await takeScreenshot('agent_interaction_sync.png');

    // 6. Mobile Layout (375x812) Viewport
    console.log('[6/6] Capturing Mobile Viewport (375x812) Storefront & Mobile Widget...');
    await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(`${FRONTEND_URL}/store`, { waitUntil: 'networkidle0' });
    await sleep(2000);
    
    // Open widget in mobile
    await page.evaluate(() => {
      const floatingBtn = document.querySelector('button[aria-label="Open NovaCart Support Chat"]');
      if (floatingBtn) floatingBtn.click();
    });
    await sleep(1500);
    await takeScreenshot('widget_mobile_375x812.png');

    console.log('\n==================================================');
    console.log('All 6 Checkpoint C Screenshots Successfully Captured!');
    console.log('==================================================\n');
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

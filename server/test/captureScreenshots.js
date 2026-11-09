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

    const resolutions = [
      { name: '1536x864', width: 1536, height: 864 },
      { name: '1440x900', width: 1440, height: 900 },
      { name: '1280x800', width: 1280, height: 800 },
    ];

    for (const res of resolutions) {
      console.log(`\n==================================================`);
      console.log(`Capturing Resolution: ${res.name} (${res.width}x${res.height})`);
      console.log(`==================================================`);
      await page.setViewport({ width: res.width, height: res.height, deviceScaleFactor: 1 });

      // 1. Split View - Both Drawers Closed (Default)
      console.log(`[${res.name}] 1. Split View - Both Drawers Closed`);
      await page.goto(`${FRONTEND_URL}/split`, { waitUntil: 'networkidle0' });
      await sleep(1500);
      await takeScreenshot(`split_view_copilot_closed_${res.name}.png`);

      // 2. Split View - Copilot Open (Inbox Closed)
      console.log(`[${res.name}] 2. Split View - Copilot Open`);
      await page.evaluate(() => {
        const btn = document.querySelector('#btn-toggle-copilot');
        if (btn) btn.click();
      });
      await sleep(1200);
      await takeScreenshot(`split_view_copilot_open_${res.name}.png`);

      // 3. Split View - Switch directly to Inbox Drawer (Copilot Closes Automatically)
      console.log(`[${res.name}] 3. Split View - Inbox Drawer Open`);
      await page.evaluate(() => {
        const btn = document.querySelector('#btn-toggle-inbox');
        if (btn) btn.click();
      });
      await sleep(1200);
      await takeScreenshot(`split_view_inbox_open_${res.name}.png`);

      // Close Inbox drawer
      await page.evaluate(() => {
        const btn = document.querySelector('#btn-close-inbox-drawer') || document.querySelector('#btn-toggle-inbox');
        if (btn) btn.click();
      });
      await sleep(600);

      // 4. Standalone Customer Portal - English
      console.log(`[${res.name}] 4. Standalone Customer Portal (English)`);
      await page.goto(`${FRONTEND_URL}/customer`, { waitUntil: 'networkidle0' });
      await sleep(1200);
      await takeScreenshot(`customer_portal_desktop_${res.name}.png`);

      // 5. Standalone Agent Dashboard - Copilot Closed
      console.log(`[${res.name}] 5. Standalone Agent Dashboard - Copilot Closed`);
      await page.goto(`${FRONTEND_URL}/agent`, { waitUntil: 'networkidle0' });
      await sleep(1200);
      await takeScreenshot(`agent_dashboard_copilot_closed_${res.name}.png`);

      // 6. Standalone Agent Dashboard - Copilot Open
      console.log(`[${res.name}] 6. Standalone Agent Dashboard - Copilot Open`);
      await page.evaluate(() => {
        const btn = document.querySelector('#btn-toggle-copilot');
        if (btn) btn.click();
      });
      await sleep(1200);
      await takeScreenshot(`agent_dashboard_copilot_open_${res.name}.png`);
    }

    // =========================================================================
    // NEW REQUIREMENTS: CUSTOMER IDENTITY & INITIAL EXPERIENCE GALLERY
    // =========================================================================
    console.log('\n--- Customer Identity & Initial Experience Gallery (1536x864) ---');
    await page.setViewport({ width: 1536, height: 864, deviceScaleFactor: 1 });

    // 1. First-time customer opening the portal as Aarav
    console.log('[Identity] 1. First-time customer opening as Aarav Sharma');
    await page.goto(`${FRONTEND_URL}/customer?customer=cust_aarav&view=welcome`, { waitUntil: 'networkidle0' });
    await sleep(1200);
    await takeScreenshot('first_time_customer_aarav_1536x864.png');

    // 2. First-time customer opening as Priya Mehta
    console.log('[Identity] 2. First-time customer opening as Priya Mehta');
    await page.goto(`${FRONTEND_URL}/customer?customer=cust_priya&view=welcome`, { waitUntil: 'networkidle0' });
    await sleep(1200);
    await takeScreenshot('first_time_customer_priya_1536x864.png');

    // 3. First-time customer opening as Kabir Verma
    console.log('[Identity] 3. First-time customer opening as Kabir Verma');
    await page.goto(`${FRONTEND_URL}/customer?customer=cust_kabir&view=welcome`, { waitUntil: 'networkidle0' });
    await sleep(1200);
    await takeScreenshot('first_time_customer_kabir_1536x864.png');

    // 4. Returning customer with an existing conversation
    console.log('[Identity] 4. Returning customer with existing conversation');
    await page.goto(`${FRONTEND_URL}/customer?customer=cust_aarav&view=chat`, { waitUntil: 'networkidle0' });
    await sleep(1200);
    await takeScreenshot('returning_customer_conversation_1536x864.png');

    // 5. Welcome experience in English, Hindi, and Marathi
    console.log('\n--- Multilingual Welcome Experience Screenshots ---');
    await page.goto(`${FRONTEND_URL}/customer?customer=cust_aarav&view=welcome`, { waitUntil: 'networkidle0' });
    await sleep(1000);
    await takeScreenshot('welcome_experience_english_1536x864.png');

    // Hindi
    await page.select('#customer-language-select', 'hi');
    await sleep(1000);
    await takeScreenshot('welcome_experience_hindi_1536x864.png');
    await takeScreenshot('customer_portal_hindi_1536x864.png');

    // Marathi
    await page.select('#customer-language-select', 'mr');
    await sleep(1000);
    await takeScreenshot('welcome_experience_marathi_1536x864.png');
    await takeScreenshot('customer_portal_marathi_1536x864.png');

    // Return to English
    await page.select('#customer-language-select', 'en');
    await sleep(1000);

    // 6. Customer Portal inside Split View
    console.log('\n--- Customer Portal inside Split View ---');
    await page.goto(`${FRONTEND_URL}/split`, { waitUntil: 'networkidle0' });
    await sleep(1500);
    await takeScreenshot('customer_portal_in_split_view_1536x864.png');

    // Attachment Upload and Preview Screenshot
    console.log('\n--- Attachment Upload and Preview Screenshot ---');
    await page.goto(`${FRONTEND_URL}/customer?customer=cust_aarav&view=chat`, { waitUntil: 'networkidle0' });
    await sleep(1000);
    await page.evaluate(() => {
      // Trigger damage quick action and attach sample proof image
      const btns = Array.from(document.querySelectorAll('button'));
      const damageBtn = btns.find(b => b.textContent.includes('Report damaged product') || b.textContent.includes('खराब उत्पादनाची तक्रार') || b.textContent.includes('क्षतिग्रस्त उत्पाद'));
      if (damageBtn) damageBtn.click();
    });
    // Set attachment state via file input
    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      // Create a small test image in memory and upload
      const testImgPath = path.join(ROOT_DIR, 'test_sample_damage.png');
      const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAUSURBVGhD7cEBDQAAAMKg909tDwcUAAAcO8k2AAEPB6vQAAAAAElFTkSuQmCC', 'base64');
      fs.writeFileSync(testImgPath, pngBuffer);
      await fileInput.uploadFile(testImgPath);
      await sleep(1000);
      try { fs.unlinkSync(testImgPath); } catch (e) {}
    }
    await takeScreenshot('customer_portal_attachment_preview_1536x864.png');

    // 8. Agent Dashboard Showing Customer Feedback
    console.log('\n--- Agent Dashboard Showing Customer Feedback ---');
    try {
      await axios.post(`${BACKEND_URL}/api/tickets/tkt_1021/feedback`, {
        resolved: true,
        rating: 5,
        comment: 'Resolved within minutes! Exceptional customer care.',
        submittedAt: new Date().toISOString()
      });
    } catch (e) {
      console.warn('Feedback seed note:', e.message);
    }
    await page.goto(`${FRONTEND_URL}/agent`, { waitUntil: 'networkidle0' });
    await sleep(1500);
    await takeScreenshot('agent_dashboard_with_feedback_1536x864.png');

    // Responsive Mobile & Tablet Verification
    console.log('\n--- Responsive Tablet & Mobile Verification ---');
    await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 1 });
    await page.goto(`${FRONTEND_URL}/split`, { waitUntil: 'networkidle0' });
    await sleep(1000);
    await takeScreenshot('tablet_view_768x1024.png');

    await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 });
    await page.goto(`${FRONTEND_URL}/agent`, { waitUntil: 'networkidle0' });
    await sleep(1000);
    await takeScreenshot('mobile_agent_chat_375x812.png');

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const inboxBtn = btns.find(b => b.textContent.includes('Inbox'));
      if (inboxBtn) inboxBtn.click();
    });
    await sleep(800);
    await takeScreenshot('mobile_agent_inbox_375x812.png');

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const copilotTab = btns.find(b => b.textContent.includes('Copilot'));
      if (copilotTab) copilotTab.click();
    });
    await sleep(800);
    await takeScreenshot('mobile_agent_copilot_375x812.png');

    await page.goto(`${FRONTEND_URL}/customer`, { waitUntil: 'networkidle0' });
    await sleep(1000);
    await takeScreenshot('mobile_customer_portal_375x812.png');

    console.log('\n==================================================');
    console.log('All Screenshots Across All Breakpoints Captured!');
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

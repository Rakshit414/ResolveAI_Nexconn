import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BACKEND_URL = 'http://127.0.0.1:5000';
const FRONTEND_URL = 'http://127.0.0.1:5173';

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

async function selectTicketInAgent(page, name) {
  const clicked = await page.evaluate((targetName) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => {
      const isInboxBtn = b.querySelector('img') && b.textContent.includes(targetName);
      return isInboxBtn || b.textContent.includes(targetName);
    });
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }, name);
  console.log(` -> Selecting ticket "${name}" in Agent dashboard: ${clicked ? 'SUCCESS' : 'NOT FOUND'}`);
  await sleep(2000);
}

async function runLiveVerification() {
  console.log('================================================================');
  console.log('     RESOLVE AI — MILESTONE 2 FINAL LIVE BROWSER VERIFICATION    ');
  console.log('================================================================\n');

  let backendProc = null;
  let frontendProc = null;
  let browser = null;

  try {
    // 1. Start Express Backend if not already running
    const backendAlive = await axios.get(`${BACKEND_URL}/api/health`, { timeout: 1000 }).then(() => true).catch(() => false);
    if (!backendAlive) {
      console.log('[Step 1] Spawning Express Backend server...');
      backendProc = spawn('node', ['server/src/server.js'], {
        cwd: ROOT_DIR,
        stdio: 'pipe',
        env: { ...process.env, PORT: '5000' }
      });

      backendProc.stdout.on('data', data => {
        const line = data.toString().trim();
        if (line.includes('running') || line.includes('POST /api/nexconn') || line.includes('Error')) {
          console.log(`[Backend Log] ${line}`);
        }
      });
      backendProc.stderr.on('data', data => {
        console.error(`[Backend Err] ${data.toString().trim()}`);
      });
    } else {
      console.log('[Step 1] Backend server already running on port 5000.');
    }

    // 2. Start Vite Preview Frontend if not already running
    const frontendAlive = await axios.get(FRONTEND_URL, { timeout: 1000 }).then(() => true).catch(() => false);
    if (!frontendAlive) {
      console.log('[Step 2] Spawning Vite Frontend server on port 5173...');
      frontendProc = spawn('node', ['./node_modules/vite/bin/vite.js', 'preview', '--port', '5173', '--host', '127.0.0.1'], {
        cwd: path.resolve(ROOT_DIR, 'client'),
        stdio: 'pipe'
      });
      frontendProc.stdout.on('data', data => {
        const line = data.toString().trim();
        if (line.includes('Local:')) console.log(`[Frontend Log] ${line}`);
      });
      frontendProc.stderr.on('data', data => {
        console.error(`[Frontend Err] ${data.toString().trim()}`);
      });
    } else {
      console.log('[Step 2] Frontend server already running on port 5173.');
    }

    // Wait for both to be accessible
    console.log('[Step 3] Waiting for Backend and Frontend servers to be ready...');
    await waitForServer(`${BACKEND_URL}/api/health`, 15000);
    console.log(' -> Backend is READY at', BACKEND_URL);
    await waitForServer(FRONTEND_URL, 15000);
    console.log(' -> Frontend is READY at', FRONTEND_URL);

    // 3. Launch Chrome with isolated contexts
    console.log('\n[Step 4] Launching Google Chrome via Puppeteer...');
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      defaultViewport: { width: 1440, height: 900 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--window-size=1440,900'
      ]
    });

    const chromeVersion = await browser.version();
    console.log(` -> Chrome Launched: ${chromeVersion}`);

    // Create 4 isolated browser contexts
    const contextAgent = await browser.createBrowserContext();
    const contextAarav = await browser.createBrowserContext();
    const contextPriya = await browser.createBrowserContext();
    const contextKabir = await browser.createBrowserContext();

    const pageAgent = await contextAgent.newPage();
    const pageAarav = await contextAarav.newPage();
    const pagePriya = await contextPriya.newPage();
    const pageKabir = await contextKabir.newPage();

    // Log collectors
    const agentLogs = [];
    const aaravLogs = [];
    const priyaLogs = [];
    const kabirLogs = [];

    function attachConsole(page, name, arr) {
      page.on('console', msg => {
        const text = msg.text();
        arr.push(`[${name} Console] ${text}`);
        if (text.includes('[Nexconn]') || text.includes('SDK') || text.includes('sendMessage') || text.includes('received')) {
          console.log(`[${name}] ${text}`);
        }
      });
    }
    attachConsole(pageAgent, 'Agent', agentLogs);
    attachConsole(pageAarav, 'Aarav', aaravLogs);
    attachConsole(pagePriya, 'Priya', priyaLogs);
    attachConsole(pageKabir, 'Kabir', kabirLogs);

    pageAgent.on('pageerror', err => console.error('[Agent PageErr]:', err.message));
    pageAarav.on('pageerror', err => console.error('[Aarav PageErr]:', err.message));
    pagePriya.on('pageerror', err => console.error('[Priya PageErr]:', err.message));
    pageKabir.on('pageerror', err => console.error('[Kabir PageErr]:', err.message));

    // 4. Open Agent Dashboard
    console.log('\n[Step 5] Opening Agent Dashboard in isolated context...');
    await pageAgent.goto(`${FRONTEND_URL}/agent`, { waitUntil: 'domcontentloaded' });
    await sleep(2500);

    // 5. Open Customer Aarav
    console.log('[Step 6] Opening Customer Aarav Portal in isolated context...');
    await pageAarav.goto(`${FRONTEND_URL}/customer?id=cust_aarav`, { waitUntil: 'domcontentloaded' });
    await sleep(2500);

    // 6. Open Customer Priya
    console.log('[Step 7] Opening Customer Priya Portal in isolated context...');
    await pagePriya.goto(`${FRONTEND_URL}/customer?id=cust_priya`, { waitUntil: 'domcontentloaded' });
    await sleep(2500);

    // 7. Open Customer Kabir
    console.log('[Step 8] Opening Customer Kabir Portal in isolated context...');
    await pageKabir.goto(`${FRONTEND_URL}/customer?id=cust_kabir`, { waitUntil: 'domcontentloaded' });
    await sleep(2500);

    console.log('\n--- VERIFYING NEXCONN SDK INITIALIZATION ACROSS CLIENTS ---');
    const agentNexconnLogs = agentLogs.filter(l => l.includes('Nexconn'));
    const aaravNexconnLogs = aaravLogs.filter(l => l.includes('Nexconn'));
    const priyaNexconnLogs = priyaLogs.filter(l => l.includes('Nexconn'));
    const kabirNexconnLogs = kabirLogs.filter(l => l.includes('Nexconn'));

    console.log('Agent Nexconn Logs:', agentNexconnLogs);
    console.log('Aarav Nexconn Logs:', aaravNexconnLogs);
    console.log('Priya Nexconn Logs:', priyaNexconnLogs);
    console.log('Kabir Nexconn Logs:', kabirNexconnLogs);

    // =======================================================================
    // TEST 1: Aarav sends a message -> Agent sees it -> Agent replies
    // =======================================================================
    console.log('\n--- TEST 1: Aarav (NC1021) ↔ Agent Live Message Flow ---');
    const aaravTestMsg = `Aarav Live Query ${Date.now()}: Where is my order NC1021?`;
    await pageAarav.type('input[placeholder*="Type your message"]', aaravTestMsg);
    await pageAarav.click('button[type="submit"]');
    console.log(` -> Sent from Aarav: "${aaravTestMsg}"`);
    await sleep(4000);

    const aaravHasSent = await pageAarav.evaluate(txt => document.body.innerText.includes(txt), aaravTestMsg);
    console.log(` -> Aarav sees sent message in his portal: ${aaravHasSent ? 'PASS' : 'FAIL'}`);

    await selectTicketInAgent(pageAgent, 'Aarav Sharma');
    await sleep(2000);

    const agentSeesAaravMsg = await pageAgent.evaluate(txt => document.body.innerText.includes(txt), aaravTestMsg);
    console.log(` -> Agent sees Aarav message in NC1021 conversation: ${agentSeesAaravMsg ? 'PASS' : 'FAIL'}`);

    // Agent replies to Aarav
    const agentReplyAarav = `Sarah Reply to Aarav ${Date.now()}: Priority courier dispatched for your shoes.`;
    await pageAgent.type('form input[type="text"]', agentReplyAarav);
    await pageAgent.click('form button[type="submit"]');
    console.log(` -> Agent replied: "${agentReplyAarav}"`);
    await sleep(4000);

    const aaravReceivedReply = await pageAarav.evaluate(txt => document.body.innerText.includes(txt), agentReplyAarav);
    console.log(` -> Aarav received Agent reply: ${aaravReceivedReply ? 'PASS' : 'FAIL'}`);

    const aaravReplyCount = await pageAarav.evaluate(txt => document.body.innerText.split(txt).length - 1, agentReplyAarav);
    console.log(` -> Exact count of reply in Aarav conversation: ${aaravReplyCount} (Expected: 1)`);

    const priyaLeakedAarav = await pagePriya.evaluate(txt => document.body.innerText.includes(txt), agentReplyAarav);
    const kabirLeakedAarav = await pageKabir.evaluate(txt => document.body.innerText.includes(txt), agentReplyAarav);
    console.log(` -> Priya cross-leakage check (Aarav's reply): ${priyaLeakedAarav ? 'FAIL (LEAK)' : 'PASS (0 LEAK)'}`);
    console.log(` -> Kabir cross-leakage check (Aarav's reply): ${kabirLeakedAarav ? 'FAIL (LEAK)' : 'PASS (0 LEAK)'}`);

    // =======================================================================
    // TEST 2: Priya sends a message -> Agent sees it -> Agent replies
    // =======================================================================
    console.log('\n--- TEST 2: Priya (NC1022) ↔ Agent Live Message Flow ---');
    const priyaTestMsg = `Priya Live Query ${Date.now()}: Returning smartwatch order NC1022.`;
    await pagePriya.type('input[placeholder*="Type your message"]', priyaTestMsg);
    await pagePriya.click('button[type="submit"]');
    console.log(` -> Sent from Priya: "${priyaTestMsg}"`);
    await sleep(4000);

    await selectTicketInAgent(pageAgent, 'Priya Mehta');
    await sleep(2000);

    const agentSeesPriyaMsg = await pageAgent.evaluate(txt => document.body.innerText.includes(txt), priyaTestMsg);
    console.log(` -> Agent sees Priya message in NC1022 conversation: ${agentSeesPriyaMsg ? 'PASS' : 'FAIL'}`);

    const agentReplyPriya = `Sarah Reply to Priya ${Date.now()}: Pre-paid return shipping label generated.`;
    await pageAgent.type('form input[type="text"]', agentReplyPriya);
    await pageAgent.click('form button[type="submit"]');
    console.log(` -> Agent replied to Priya: "${agentReplyPriya}"`);
    await sleep(4000);

    const priyaReceivedReply = await pagePriya.evaluate(txt => document.body.innerText.includes(txt), agentReplyPriya);
    console.log(` -> Priya received Agent reply: ${priyaReceivedReply ? 'PASS' : 'FAIL'}`);

    const priyaReplyCount = await pagePriya.evaluate(txt => document.body.innerText.split(txt).length - 1, agentReplyPriya);
    console.log(` -> Exact count of reply in Priya conversation: ${priyaReplyCount} (Expected: 1)`);

    const aaravLeakedPriya = await pageAarav.evaluate(txt => document.body.innerText.includes(txt), agentReplyPriya);
    const kabirLeakedPriya = await pageKabir.evaluate(txt => document.body.innerText.includes(txt), agentReplyPriya);
    console.log(` -> Aarav cross-leakage check (Priya's reply): ${aaravLeakedPriya ? 'FAIL (LEAK)' : 'PASS (0 LEAK)'}`);
    console.log(` -> Kabir cross-leakage check (Priya's reply): ${kabirLeakedPriya ? 'FAIL (LEAK)' : 'PASS (0 LEAK)'}`);

    // =======================================================================
    // TEST 3: Kabir sends a message -> Agent sees it -> Agent replies
    // =======================================================================
    console.log('\n--- TEST 3: Kabir (NC1023) ↔ Agent Live Message Flow ---');
    const kabirTestMsg = `Kabir Live Query ${Date.now()}: Received wrong item in order NC1023.`;
    await pageKabir.type('input[placeholder*="Type your message"]', kabirTestMsg);
    await pageKabir.click('button[type="submit"]');
    console.log(` -> Sent from Kabir: "${kabirTestMsg}"`);
    await sleep(4000);

    await selectTicketInAgent(pageAgent, 'Kabir Verma');
    await sleep(2000);

    const agentSeesKabirMsg = await pageAgent.evaluate(txt => document.body.innerText.includes(txt), kabirTestMsg);
    console.log(` -> Agent sees Kabir message in NC1023 conversation: ${agentSeesKabirMsg ? 'PASS' : 'FAIL'}`);

    const agentReplyKabir = `Sarah Reply to Kabir ${Date.now()}: Expedited replacement authorized.`;
    await pageAgent.type('form input[type="text"]', agentReplyKabir);
    await pageAgent.click('form button[type="submit"]');
    console.log(` -> Agent replied to Kabir: "${agentReplyKabir}"`);
    await sleep(4000);

    const kabirReceivedReply = await pageKabir.evaluate(txt => document.body.innerText.includes(txt), agentReplyKabir);
    console.log(` -> Kabir received Agent reply: ${kabirReceivedReply ? 'PASS' : 'FAIL'}`);

    const kabirReplyCount = await pageKabir.evaluate(txt => document.body.innerText.split(txt).length - 1, agentReplyKabir);
    console.log(` -> Exact count of reply in Kabir conversation: ${kabirReplyCount} (Expected: 1)`);

    const aaravLeakedKabir = await pageAarav.evaluate(txt => document.body.innerText.includes(txt), agentReplyKabir);
    const priyaLeakedKabir = await pagePriya.evaluate(txt => document.body.innerText.includes(txt), agentReplyKabir);
    console.log(` -> Aarav cross-leakage check (Kabir's reply): ${aaravLeakedKabir ? 'FAIL (LEAK)' : 'PASS (0 LEAK)'}`);
    console.log(` -> Priya cross-leakage check (Kabir's reply): ${priyaLeakedKabir ? 'FAIL (LEAK)' : 'PASS (0 LEAK)'}`);

    // =======================================================================
    // TEST 4: Refresh and verify conversation independence
    // =======================================================================
    console.log('\n--- TEST 4: Refresh & Persistence Verification ---');
    await pageAarav.reload({ waitUntil: 'domcontentloaded' });
    await sleep(2000);
    const aaravHasHistoryAfterReload = await pageAarav.evaluate(txt => document.body.innerText.includes(txt), aaravTestMsg);
    const aaravStillNoPriyaAfterReload = !(await pageAarav.evaluate(txt => document.body.innerText.includes(txt), agentReplyPriya));
    console.log(` -> Aarav retains own message history after reload: ${aaravHasHistoryAfterReload ? 'PASS' : 'FAIL'}`);
    console.log(` -> Aarav still has 0 Priya messages after reload: ${aaravStillNoPriyaAfterReload ? 'PASS' : 'FAIL'}`);

    // =======================================================================
    // TEST 5: Verify Gemini Copilot Panel in Agent Dashboard
    // =======================================================================
    console.log('\n--- TEST 5: Verify Gemini Copilot Integration in Browser ---');
    const copilotInfo = await pageAgent.evaluate(() => {
      const panel = document.querySelector('div[class*="border-l"]');
      return {
        hasCopilotHeader: document.body.innerText.includes('AI Copilot'),
        hasSuggestedReply: document.body.innerText.includes('Approve & Send') || document.body.innerText.includes('Send Reply') || document.body.innerText.includes('Suggested Response'),
        hasPolicies: document.body.innerText.includes('Policy') || document.body.innerText.includes('NovaCart'),
      };
    });
    console.log(' -> Agent Dashboard Copilot View:', copilotInfo);

    // =======================================================================
    // TEST 6: Security & Secret Exposure Audit
    // =======================================================================
    console.log('\n--- TEST 6: Security & Secret Exposure Audit ---');
    const appSecret = process.env.NEXCONN_APP_SECRET;
    const geminiKey = process.env.GEMINI_API_KEY;

    const aaravExposesSecret = await pageAarav.evaluate((sec, gem) => {
      const html = document.documentElement.innerHTML;
      return (sec && html.includes(sec)) || (gem && html.includes(gem));
    }, appSecret, geminiKey);

    const agentExposesSecret = await pageAgent.evaluate((sec, gem) => {
      const html = document.documentElement.innerHTML;
      return (sec && html.includes(sec)) || (gem && html.includes(gem));
    }, appSecret, geminiKey);

    console.log(` -> Customer DOM exposes secrets: ${aaravExposesSecret ? 'FAIL (EXPOSED)' : 'PASS (No secrets exposed)'}`);
    console.log(` -> Agent DOM exposes secrets: ${agentExposesSecret ? 'FAIL (EXPOSED)' : 'PASS (No secrets exposed)'}`);

    console.log('\n================================================================');
    console.log('              LIVE BROWSER VERIFICATION COMPLETE                ');
    console.log('================================================================\n');

  } catch (err) {
    console.error('VERIFICATION ERROR:', err);
  } finally {
    if (browser) {
      console.log('Closing Chrome browser...');
      await browser.close();
    }
    if (frontendProc) {
      console.log('Stopping frontend server...');
      frontendProc.kill();
    }
    if (backendProc) {
      console.log('Stopping backend server...');
      backendProc.kill();
    }
  }
}

runLiveVerification();

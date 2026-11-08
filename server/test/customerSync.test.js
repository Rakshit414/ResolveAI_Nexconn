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
      // retry
    }
    await sleep(500);
  }
  throw new Error(`Server at ${url} failed to respond within ${timeoutMs}ms`);
}

async function ensureServers() {
  const processes = [];

  const backendAlive = await axios.get(`${BACKEND_URL}/api/health`, { timeout: 1000 }).then(() => true).catch(() => false);
  if (!backendAlive) {
    console.log('[Setup] Spawning Express Backend server...');
    const backendProc = spawn('node', ['server/src/server.js'], {
      cwd: ROOT_DIR,
      stdio: 'pipe',
      env: { ...process.env, PORT: '5000' }
    });
    processes.push(backendProc);
  }

  const frontendAlive = await axios.get(FRONTEND_URL, { timeout: 1000 }).then(() => true).catch(() => false);
  if (!frontendAlive) {
    console.log('[Setup] Spawning Vite Frontend server...');
    const frontendProc = spawn('node', ['./node_modules/vite/bin/vite.js', 'preview', '--port', '5173', '--host', '127.0.0.1'], {
      cwd: path.resolve(ROOT_DIR, 'client'),
      stdio: 'pipe'
    });
    processes.push(frontendProc);
  }

  await waitForServer(`${BACKEND_URL}/api/health`, 20000);
  await waitForServer(FRONTEND_URL, 20000);
  return processes;
}

async function runCustomerSyncTests() {
  console.log('================================================================');
  console.log('    RESOLVE AI — CUSTOMER SYNCHRONIZATION TEST SUITE            ');
  console.log('================================================================\n');

  const processes = await ensureServers();
  let totalTests = 0;
  let passedTests = 0;

  function assert(name, condition, details = '') {
    totalTests++;
    if (condition) {
      console.log(`[PASS] ${name}${details ? ` -> ${details}` : ''}`);
      passedTests++;
    } else {
      console.error(`[FAIL] ${name}${details ? ` -> ${details}` : ''}`);
    }
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security', '--window-size=1536,864']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1536, height: 864 });

    // Open Split View
    await page.goto(`${FRONTEND_URL}/split`, { waitUntil: 'networkidle0' });
    await sleep(2000);

    // Helper: Select customer via top Navbar dropdown
    async function selectNavbarCustomer(name) {
      // 1. Open dropdown
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const dropdownBtn = btns.find(b => b.title && b.title.includes('Switch demo customer identity'));
        if (dropdownBtn) dropdownBtn.click();
      });
      await sleep(400);

      // 2. Click target customer item
      const clicked = await page.evaluate((targetName) => {
        const btns = Array.from(document.querySelectorAll('button'));
        const custItem = btns.find(b => b.textContent.includes(targetName) && b.querySelector('img'));
        if (custItem) {
          custItem.click();
          return true;
        }
        return false;
      }, name);
      await sleep(1500);
      return clicked;
    }

    // Helper: Get Customer Portal info from left pane
    async function getCustomerPaneInfo() {
      return await page.evaluate(() => {
        const custChat = document.getElementById('customer-chat-messages');
        const text = document.body.innerText;
        return {
          hasAarav: text.includes('NC1021') || text.includes('NovaSprint'),
          hasPriya: text.includes('NC1022') || text.includes('NovaPulse') || text.includes('Smartwatch'),
          hasKabir: text.includes('NC1023') || text.includes('NovaBass') || text.includes('Earphones'),
          chatText: custChat ? custChat.innerText : '',
        };
      });
    }

    // Helper: Get Agent Workspace active ticket from center/right
    async function getAgentActiveTicket() {
      return await page.evaluate(() => {
        const text = document.body.innerText;
        return {
          hasAarav: text.includes('Aarav Sharma') && text.includes('NC1021'),
          hasPriya: text.includes('Priya Mehta') && text.includes('NC1022'),
          hasKabir: text.includes('Kabir Verma') && text.includes('NC1023'),
        };
      });
    }

    // Test 1: Select Aarav
    console.log('--- Test 1: Select Aarav via Navbar ---');
    await selectNavbarCustomer('Aarav Sharma');
    const stateAarav = await getCustomerPaneInfo();
    const agentAarav = await getAgentActiveTicket();
    assert('Sync 1: Aarav selected -> Left pane shows NC1021', stateAarav.hasAarav);
    assert('Sync 1.2: Aarav selected -> Agent pane shows Aarav Sharma (NC1021)', agentAarav.hasAarav);

    // Test 2: Select Priya
    console.log('\n--- Test 2: Select Priya via Navbar ---');
    await selectNavbarCustomer('Priya Mehta');
    const statePriya = await getCustomerPaneInfo();
    const agentPriya = await getAgentActiveTicket();
    assert('Sync 2.1: Priya selected -> Left pane shows NC1022 (Smartwatch)', statePriya.hasPriya);
    assert('Sync 2.2: Priya selected -> Agent pane shows Priya Mehta (NC1022)', agentPriya.hasPriya);

    // Test 3: Select Kabir
    console.log('\n--- Test 3: Select Kabir via Navbar ---');
    await selectNavbarCustomer('Kabir Verma');
    const stateKabir = await getCustomerPaneInfo();
    const agentKabir = await getAgentActiveTicket();
    assert('Sync 3.1: Kabir selected -> Left pane shows NC1023 (Earphones)', stateKabir.hasKabir);
    assert('Sync 3.2: Kabir selected -> Agent pane shows Kabir Verma (NC1023)', agentKabir.hasKabir);

    // Test 4: Rapid Switch Sequence Aarav -> Priya -> Kabir -> Aarav
    console.log('\n--- Test 4: Rapid Cycle Aarav -> Priya -> Kabir -> Aarav ---');
    await selectNavbarCustomer('Aarav Sharma');
    await sleep(600);
    await selectNavbarCustomer('Priya Mehta');
    await sleep(600);
    await selectNavbarCustomer('Kabir Verma');
    await sleep(600);
    await selectNavbarCustomer('Aarav Sharma');
    await sleep(1500);

    const finalState = await getCustomerPaneInfo();
    const finalAgent = await getAgentActiveTicket();
    assert('Sync 4.1: Cycle back to Aarav -> Customer pane shows Aarav', finalState.hasAarav);
    assert('Sync 4.2: Cycle back to Aarav -> Agent pane shows Aarav', finalAgent.hasAarav);

    // Test 5: Switch via Customer Portal tab on Left pane
    console.log('\n--- Test 5: Switch via Customer Portal Tab ---');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const priyaTab = btns.find(b => b.textContent.trim() === 'Priya');
      if (priyaTab) priyaTab.click();
    });
    await sleep(1500);

    const leftTabSwitch = await getCustomerPaneInfo();
    const agentSyncFromTab = await getAgentActiveTicket();
    assert('Sync 5.1: Clicked Priya tab -> Customer pane switched to Priya', leftTabSwitch.hasPriya);
    assert('Sync 5.2: Clicked Priya tab -> Agent pane synchronized to Priya', agentSyncFromTab.hasPriya);

    // Test 6: Switch via Agent Inbox
    console.log('\n--- Test 6: Switch via Agent Inbox Ticket Item ---');
    // Open inbox drawer if in split view
    await page.evaluate(() => {
      const inboxToggle = document.querySelector('#btn-toggle-inbox');
      if (inboxToggle) inboxToggle.click();
    });
    await sleep(600);

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const kabirInbox = btns.find(b => b.textContent.includes('Kabir Verma') && b.querySelector('img'));
      if (kabirInbox) kabirInbox.click();
    });
    await sleep(1500);

    const leftSyncFromInbox = await getCustomerPaneInfo();
    const agentInboxSwitch = await getAgentActiveTicket();
    assert('Sync 6.1: Clicked Kabir in Inbox -> Agent pane active on Kabir', agentInboxSwitch.hasKabir);
    assert('Sync 6.2: Clicked Kabir in Inbox -> Customer pane synchronized to Kabir', leftSyncFromInbox.hasKabir);

    // Test 7: Verify Copilot Context reflects active customer
    console.log('\n--- Test 7: Verify Copilot Context reflects active customer ---');
    // Open copilot
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const copilotBtn = btns.find(b => b.textContent.includes('Copilot'));
      if (copilotBtn) copilotBtn.click();
    });
    await sleep(2000);

    const copilotMatchesKabir = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('NovaBass') || text.includes('earphones') || text.includes('Defective') || text.includes('replacement');
    });
    assert('Sync 7: Copilot displays contextual suggestion matching Kabir (NovaBass)', copilotMatchesKabir);

    // Test 8: Refresh Split View and check initial sync
    console.log('\n--- Test 8: Refresh Split View and check initialization ---');
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(2500);

    const reloadedLeft = await getCustomerPaneInfo();
    const reloadedRight = await getAgentActiveTicket();
    assert('Sync 8.1: Both panes initialize with same customer after reload', (reloadedLeft.hasAarav && reloadedRight.hasAarav) || (reloadedLeft.hasKabir && reloadedRight.hasKabir));

    console.log('\n================================================================');
    console.log(`CUSTOMER SYNCHRONIZATION SUITE: ${passedTests}/${totalTests} PASSED`);
    console.log('================================================================\n');

  } finally {
    await browser.close();
    for (const p of processes) {
      try { p.kill(); } catch (e) {}
    }
  }
}

runCustomerSyncTests().catch(err => {
  console.error('Customer sync test failed:', err);
  process.exit(1);
});

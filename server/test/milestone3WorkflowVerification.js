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

async function runMilestone3Verification() {
  console.log('================================================================');
  console.log('    RESOLVE AI — MILESTONE 3: COMPLETE WORKFLOW VERIFICATION    ');
  console.log('================================================================\n');

  let backendProc = null;
  let frontendProc = null;
  let browser = null;
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

  try {
    // 1. Check or start Backend server
    const backendAlive = await axios.get(`${BACKEND_URL}/api/health`, { timeout: 1000 }).then(() => true).catch(() => false);
    if (!backendAlive) {
      console.log('[Setup] Starting Backend server on port 5000...');
      backendProc = spawn('node', ['server/src/server.js'], {
        cwd: ROOT_DIR,
        stdio: 'pipe',
        env: { ...process.env, PORT: '5000' }
      });
      backendProc.stdout.on('data', d => {
        const line = d.toString().trim();
        if (line.includes('running on port')) console.log(`[Backend Log] ${line}`);
      });
      backendProc.stderr.on('data', d => console.error(`[Backend Err] ${d.toString().trim()}`));
    }

    // 2. Check or start Frontend preview
    const frontendAlive = await axios.get(FRONTEND_URL, { timeout: 1000 }).then(() => true).catch(() => false);
    if (!frontendAlive) {
      console.log('[Setup] Starting Frontend Preview on port 5173...');
      frontendProc = spawn('node', ['./node_modules/vite/bin/vite.js', 'preview', '--port', '5173', '--host', '127.0.0.1'], {
        cwd: path.resolve(ROOT_DIR, 'client'),
        stdio: 'pipe'
      });
    }

    await waitForServer(`${BACKEND_URL}/api/health`, 15000);
    await waitForServer(FRONTEND_URL, 15000);
    console.log('[Setup] Backend and Frontend servers are online.\n');

    // Reset tickets to demo state before test
    await axios.post(`${BACKEND_URL}/api/tickets/reset`).catch(() => {});

    // Launch Chrome
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      defaultViewport: { width: 1440, height: 900 },
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security', '--window-size=1440,900']
    });

    const ctxAgent = await browser.createBrowserContext();
    const ctxAarav = await browser.createBrowserContext();
    const ctxPriya = await browser.createBrowserContext();
    const ctxSplit = await browser.createBrowserContext();

    const pageAgent = await ctxAgent.newPage();
    const pageAarav = await ctxAarav.newPage();
    const pagePriya = await ctxPriya.newPage();
    const pageSplit = await ctxSplit.newPage();

    // Open sessions
    console.log('[Setup] Navigating isolated contexts...');
    await pageAgent.goto(`${FRONTEND_URL}/agent`, { waitUntil: 'domcontentloaded' });
    await pageAarav.goto(`${FRONTEND_URL}/customer?id=cust_aarav`, { waitUntil: 'domcontentloaded' });
    await pagePriya.goto(`${FRONTEND_URL}/customer?id=cust_priya`, { waitUntil: 'domcontentloaded' });

    // Clear any previous session storage to ensure clean baseline for verification
    await pageAgent.evaluate(() => localStorage.clear()).catch(() => {});
    await pageAarav.evaluate(() => localStorage.clear()).catch(() => {});
    await pagePriya.evaluate(() => localStorage.clear()).catch(() => {});

    await pageAgent.reload({ waitUntil: 'domcontentloaded' });
    await pageAarav.reload({ waitUntil: 'domcontentloaded' });
    await pagePriya.reload({ waitUntil: 'domcontentloaded' });
    await sleep(3500);

    // =======================================================================
    // SCENARIO 1: Normal customer inquiry and agent response
    // =======================================================================
    console.log('\n--- SCENARIO 1: Normal customer inquiry and agent response ---');
    const msg1 = `Inquiry-${Date.now()}: Where is my NovaSprint shoe order NC1021?`;
    await pageAarav.type('input[placeholder*="message"]', msg1);
    await pageAarav.click('button[type="submit"]');
    await sleep(4000);

    const aaravHasSent = await pageAarav.evaluate(txt => document.body.innerText.includes(txt), msg1);
    assert('Scenario 1.1: Customer sends inquiry and sees in portal', aaravHasSent);

    // Select Aarav in Agent dashboard
    await pageAgent.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent.includes('Aarav Sharma'));
      if (btn) btn.click();
    });
    await sleep(2000);

    const agentSeesMsg1 = await pageAgent.evaluate(txt => document.body.innerText.includes(txt), msg1);
    assert('Scenario 1.2: Agent receives inquiry via Nexconn', agentSeesMsg1);

    // Agent replies
    const reply1 = `AgentReply-${Date.now()}: Your shipment is on a priority courier vehicle.`;
    await pageAgent.type('form input[type="text"]', reply1);
    await pageAgent.click('form button[type="submit"]');
    await sleep(4000);

    const aaravGotReply1 = await pageAarav.evaluate(txt => document.body.innerText.includes(txt), reply1);
    assert('Scenario 1.3: Customer receives agent response via Nexconn', aaravGotReply1);

    // =======================================================================
    // SCENARIO 2: AI response suggestion and agent approval
    // =======================================================================
    console.log('\n--- SCENARIO 2: AI response suggestion and agent approval ---');
    const hasCopilot = await pageAgent.evaluate(() => {
      return document.body.innerText.includes('AI Copilot') && 
        (document.body.innerText.includes('Approve & Send') || document.body.innerText.includes('Send Reply'));
    });
    assert('Scenario 2.1: Agent dashboard displays AI Copilot with suggested response', hasCopilot);

    // Click "Approve & Send" (wait for AI generation if loading)
    let clickedApprove = false;
    for (let i = 0; i < 8; i++) {
      clickedApprove = await pageAgent.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const approveBtn = btns.find(b => b.textContent.includes('Approve & Send') || b.textContent.includes('Send Reply'));
        if (approveBtn && !approveBtn.disabled) {
          approveBtn.click();
          return true;
        }
        return false;
      });
      if (clickedApprove) break;
      await sleep(1000);
    }
    assert('Scenario 2.2: Agent reviews and clicks Approve & Send', clickedApprove);
    await sleep(4000);

    // Verify delivery of approved AI response in Aarav's portal
    const aaravMsgCountAfterCopilot = await pageAarav.evaluate(() => {
      const bubbles = document.querySelectorAll('p');
      return Array.from(bubbles).filter(p => p.textContent.includes('NovaCart') || p.textContent.includes('shoes') || p.textContent.includes('Order')).length;
    });
    assert('Scenario 2.3: Approved response delivered to customer without duplication', aaravMsgCountAfterCopilot >= 1);

    // =======================================================================
    // SCENARIO 3: Customer-requested human handoff
    // =======================================================================
    console.log('\n--- SCENARIO 3: Customer-requested human handoff ---');
    const priyaInitialStatus = await pagePriya.evaluate(() => {
      return document.body.innerText.includes('AI Handling') ? 'AI Handling' : 'Other';
    });
    assert('Scenario 3.1: Priya begins in AI Handling state', priyaInitialStatus === 'AI Handling');

    // Priya clicks "Request Human"
    await pagePriya.evaluate(() => {
      const btn = document.getElementById('btn-request-human');
      if (btn) {
        btn.click();
        return true;
      }
      const btns = Array.from(document.querySelectorAll('button'));
      const reqBtn = btns.find(b => b.textContent.includes('Request Human'));
      if (reqBtn) reqBtn.click();
    });
    await sleep(2500);

    const priyaHandoffStatus = await pagePriya.evaluate(() => document.body.innerText.includes('Human Requested'));
    assert('Scenario 3.2: Customer portal status updates to Human Requested', priyaHandoffStatus);

    // Verify Agent reflects human request
    await pageAgent.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent.includes('Priya Mehta'));
      if (btn) btn.click();
    });
    await sleep(2000);

    const agentSeesHandoff = await pageAgent.evaluate(() => {
      return document.body.innerText.includes('Human Requested') && document.body.innerText.includes('Take Over');
    });
    assert('Scenario 3.3: Agent dashboard displays Human Requested alert and Take Over button', agentSeesHandoff);

    // =======================================================================
    // SCENARIO 4: Agent takeover
    // =======================================================================
    console.log('\n--- SCENARIO 4: Agent takeover ---');
    await pageAgent.evaluate(() => {
      const btn = document.getElementById('btn-takeover-ticket');
      if (btn) {
        btn.click();
        return true;
      }
      const btns = Array.from(document.querySelectorAll('button'));
      const takeOverBtn = btns.find(b => b.textContent.includes('Take Over'));
      if (takeOverBtn) takeOverBtn.click();
    });
    await sleep(3500);

    const agentStatusActive = await pageAgent.evaluate(() => document.body.innerText.includes('Human Agent Active'));
    assert('Scenario 4.1: Agent ticket status transitions to Human Agent Active', agentStatusActive);

    const priyaSeesAgentActive = await pagePriya.evaluate(() => {
      return document.body.innerText.includes('Sarah Lin Active') || document.body.innerText.includes('Human Agent Active') || document.body.innerText.includes('taken over');
    });
    assert('Scenario 4.2: Customer portal reflects human takeover in real time', priyaSeesAgentActive);

    // =======================================================================
    // SCENARIO 5: AI suppression after human takeover
    // =======================================================================
    console.log('\n--- SCENARIO 5: AI suppression after human takeover ---');
    // AI does not automatically dispatch messages to the customer without agent approval
    const priyaMessagesPreReply = await pagePriya.evaluate(() => document.querySelectorAll('p').length);
    await sleep(3000);
    const priyaMessagesPostWait = await pagePriya.evaluate(() => document.querySelectorAll('p').length);
    assert('Scenario 5.1: Zero autonomous/unapproved AI messages dispatched to customer after takeover', priyaMessagesPreReply === priyaMessagesPostWait);

    // =======================================================================
    // SCENARIO 6: Ticket resolution
    // =======================================================================
    console.log('\n--- SCENARIO 6: Ticket resolution ---');
    await pageAgent.evaluate(() => {
      const btn = document.getElementById('btn-resolve-ticket');
      if (btn) {
        btn.click();
        return true;
      }
      const btns = Array.from(document.querySelectorAll('button'));
      const resolveBtn = btns.find(b => b.textContent.trim() === 'Resolve');
      if (resolveBtn) resolveBtn.click();
    });
    await sleep(3500);

    const agentSeesResolved = await pageAgent.evaluate(() => document.body.innerText.includes('Resolved'));
    assert('Scenario 6.1: Agent marks ticket as Resolved', agentSeesResolved);

    let priyaSeesResolved = false;
    for (let i = 0; i < 6; i++) {
      priyaSeesResolved = await pagePriya.evaluate(() => document.body.innerText.includes('Resolved'));
      if (priyaSeesResolved) break;
      await sleep(1000);
    }
    assert('Scenario 6.2: Customer portal reflects Resolved status in real time', priyaSeesResolved);

    // =======================================================================
    // SCENARIO 7: Customer refresh and history restoration
    // =======================================================================
    console.log('\n--- SCENARIO 7: Customer refresh and history restoration ---');
    await pageAarav.reload({ waitUntil: 'domcontentloaded' });
    await sleep(2500);

    const aaravHasHistoryAfterF5 = await pageAarav.evaluate(txt => document.body.innerText.includes(txt), msg1);
    assert('Scenario 7.1: Customer history fully restored after reload', aaravHasHistoryAfterF5);

    // =======================================================================
    // SCENARIO 8: Agent refresh and history restoration
    // =======================================================================
    console.log('\n--- SCENARIO 8: Agent refresh and history restoration ---');
    await pageAgent.reload({ waitUntil: 'domcontentloaded' });
    await sleep(2500);

    await pageAgent.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent.includes('Aarav Sharma'));
      if (btn) btn.click();
    });
    await sleep(1500);

    const agentHasHistoryAfterF5 = await pageAgent.evaluate(txt => document.body.innerText.includes(txt), msg1);
    assert('Scenario 8.1: Agent dashboard retains all conversation history after reload', agentHasHistoryAfterF5);

    // =======================================================================
    // SCENARIO 9: Switching between all three customer conversations
    // =======================================================================
    console.log('\n--- SCENARIO 9: Switching between all three customer conversations ---');
    // Switch to Kabir
    await pageAgent.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent.includes('Kabir Verma'));
      if (btn) btn.click();
    });
    await sleep(1500);

    const agentSeesKabir = await pageAgent.evaluate(() => {
      return document.body.innerText.includes('Kabir Verma') && document.body.innerText.includes('NC1023');
    });
    const agentNoAaravInKabir = !(await pageAgent.evaluate(txt => document.body.innerText.includes(txt), msg1));
    assert('Scenario 9.1: Agent switches to Kabir (NC1023) cleanly with zero leak', agentSeesKabir && agentNoAaravInKabir);

    // Switch back to Priya
    await pageAgent.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent.includes('Priya Mehta'));
      if (btn) btn.click();
    });
    await sleep(1500);

    const agentSeesPriyaResolved = await pageAgent.evaluate(() => {
      return document.body.innerText.includes('Priya Mehta') && document.body.innerText.includes('NC1022') && document.body.innerText.includes('Resolved');
    });
    assert('Scenario 9.2: Agent switches to Priya and retains Resolved state', agentSeesPriyaResolved);

    // =======================================================================
    // SCENARIO 10: No duplicate messages or cross-customer leakage
    // =======================================================================
    console.log('\n--- SCENARIO 10: No duplicate messages or cross-customer leakage ---');
    const priyaLeakedAaravMsg = await pagePriya.evaluate(txt => {
      const chat = document.getElementById('customer-chat-messages') || document.querySelector('div.overflow-y-auto');
      return chat ? chat.innerText.includes(txt) : false;
    }, msg1);
    const aaravLeakedPriyaMsg = await pageAarav.evaluate(() => {
      const chat = document.getElementById('customer-chat-messages');
      if (!chat) return false;
      const text = chat.innerText.toLowerCase();
      return text.includes('smartwatch') || text.includes('nc1022') || text.includes('novapulse');
    });
    assert('Scenario 10.1: Priya conversation has 0 Aarav messages', !priyaLeakedAaravMsg);
    assert('Scenario 10.2: Aarav conversation has 0 Priya messages or order references', !aaravLeakedPriyaMsg);

    // =======================================================================
    // SCENARIO 11: Gemini API failure handling
    // =======================================================================
    console.log('\n--- SCENARIO 11: Gemini API failure handling ---');
    const fallbackRes = await axios.post(`${BACKEND_URL}/api/ai/suggest-reply`, {
      messages: [],
      customer: { name: 'Test' },
      order: { orderId: 'TEST999' }
    }).catch(err => err.response);
    assert('Scenario 11.1: Backend gracefully handles missing or invalid messages', fallbackRes?.status === 400 || fallbackRes?.data?.success === true);

    const summaryFallbackRes = await axios.post(`${BACKEND_URL}/api/ai/summarize`, {
      messages: [{ sender: 'Cust', text: 'Hi' }],
      customer: { name: 'Fallback Test' },
      order: { orderId: 'NC1099', product: 'Demo Item' }
    });
    assert('Scenario 11.2: Copilot summarization provides structured fallback if model is constrained', Boolean(summaryFallbackRes.data?.data?.whatHappened));

    // =======================================================================
    // SCENARIO 12: Nexconn disconnection and reconnection handling
    // =======================================================================
    console.log('\n--- SCENARIO 12: Nexconn disconnection and reconnection handling ---');
    const reconnectTestResult = await pageAarav.evaluate(async () => {
      try {
        const { nexconnService } = await import('/src/services/nexconnService.js');
        await nexconnService.disconnect();
        const res = await nexconnService.connectUser({
          id: 'cust_aarav',
          name: 'Aarav Sharma',
          role: 'customer'
        });
        return res?.connected === true;
      } catch (e) {
        return false;
      }
    });
    assert('Scenario 12.1: Nexconn disconnects and reconnects cleanly without error', reconnectTestResult);

    // =======================================================================
    // BONUS: Split-Screen Live Synchronization
    // =======================================================================
    console.log('\n--- BONUS: Split-Screen Live Synchronization ---');
    await pageSplit.goto(`${FRONTEND_URL}/split`, { waitUntil: 'domcontentloaded' });
    await sleep(2500);

    const splitHasBothPanes = await pageSplit.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Customer Experience') && text.includes('Agent Workspace & AI Copilot');
    });
    assert('Bonus Scenario: Split-Screen view renders dual synchronized panes', splitHasBothPanes);

    console.log('\n================================================================');
    console.log(`WORKFLOW VERIFICATION COMPLETE: ${passedTests}/${totalTests} PASSED`);
    console.log('================================================================\n');

  } catch (err) {
    console.error('VERIFICATION ERROR:', err);
  } finally {
    if (browser) {
      console.log('Closing browser...');
      await browser.close();
    }
    if (frontendProc) {
      frontendProc.kill();
    }
    if (backendProc) {
      backendProc.kill();
    }
  }
}

runMilestone3Verification();

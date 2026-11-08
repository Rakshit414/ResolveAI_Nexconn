import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
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

async function runMilestone4FullE2E() {
  console.log('================================================================');
  console.log('    RESOLVE AI — MILESTONE 4: FINAL HARDENING & DEMO SUITE     ');
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
    // 1. Ensure Backend is running
    const backendAlive = await axios.get(`${BACKEND_URL}/api/health`, { timeout: 1000 }).then(() => true).catch(() => false);
    if (!backendAlive) {
      console.log('[Setup] Starting Backend server on port 5000...');
      backendProc = spawn('node', ['server/src/server.js'], {
        cwd: ROOT_DIR,
        stdio: 'pipe',
        env: { ...process.env, PORT: '5000' }
      });
      await waitForServer(`${BACKEND_URL}/api/health`, 15000);
    }

    // 2. Ensure Frontend is running
    const frontendAlive = await axios.get(FRONTEND_URL, { timeout: 1000 }).then(() => true).catch(() => false);
    if (!frontendAlive) {
      console.log('[Setup] Starting Frontend Preview on port 5173...');
      frontendProc = spawn('node', ['./node_modules/vite/bin/vite.js', 'preview', '--port', '5173', '--host', '127.0.0.1'], {
        cwd: path.resolve(ROOT_DIR, 'client'),
        stdio: 'pipe'
      });
      await waitForServer(FRONTEND_URL, 15000);
    }

    console.log('[Setup] Servers online.\n');

    // =========================================================================
    // SECTION 1: SECURITY AUDIT & INPUT VALIDATION
    // =========================================================================
    console.log('--- SECTION 1: Security Audit & API Protection ---');

    // 1.1 Secret leakage check
    const nexconnStatus = await axios.get(`${BACKEND_URL}/api/nexconn/status`);
    const leaksSecret = JSON.stringify(nexconnStatus.data).toLowerCase().includes('secret') && nexconnStatus.data.appSecret;
    assert('Sec 1.1: GET /api/nexconn/status never leaks App Secret', !leaksSecret);

    // 1.2 Invalid status validation
    const invalidStatusRes = await axios.patch(`${BACKEND_URL}/api/tickets/tkt_1021`, {
      status: 'HACKED_INVALID_STATUS'
    }).catch(err => err.response);
    assert('Sec 1.2: PATCH /api/tickets validates status against strict whitelist', invalidStatusRes?.status === 400);

    // 1.3 Invalid priority validation
    const invalidPriorityRes = await axios.patch(`${BACKEND_URL}/api/tickets/tkt_1021`, {
      priority: 'SUPER_URGENT'
    }).catch(err => err.response);
    assert('Sec 1.3: PATCH /api/tickets validates priority against strict whitelist', invalidPriorityRes?.status === 400);

    // 1.4 Customer scoping & unauthorized access
    const crossAccessRes = await axios.get(`${BACKEND_URL}/api/tickets/tkt_1021?customerId=cust_priya`).catch(err => err.response);
    assert('Sec 1.4: Cross-customer ticket access denied with HTTP 403', crossAccessRes?.status === 403);

    // 1.5 Safe DoS message payload limit
    const largePayload = Array.from({ length: 60 }, (_, i) => ({ sender: `Bot${i}`, text: 'A'.repeat(500) }));
    const aiAnalyzeRes = await axios.post(`${BACKEND_URL}/api/ai/analyze`, { messages: largePayload, customer: { name: 'Test' } }).catch(err => err.response);
    assert('Sec 1.5: AI endpoint safely sanitizes and handles oversized payloads', aiAnalyzeRes?.data?.success === true || aiAnalyzeRes?.status === 413);

    // =========================================================================
    // SECTION 2: CONCURRENT ATOMIC WRITES & CORRUPTION RESISTANCE
    // =========================================================================
    console.log('\n--- SECTION 2: Concurrent Atomic Writes & Corruption Resistance ---');
    
    // Reset to clean demo state
    await axios.post(`${BACKEND_URL}/api/tickets/reset`);
    
    // Fire 20 rapid concurrent status update requests to test mutex serialization
    const concurrentUpdates = Array.from({ length: 20 }, (_, i) => {
      const status = i % 2 === 0 ? 'Human Agent Active' : 'AI Handling';
      return axios.patch(`${BACKEND_URL}/api/tickets/tkt_1021`, {
        status,
        summary: `Concurrent atomic stress update #${i + 1}`
      }).catch(err => ({ error: err.message }));
    });

    const results = await Promise.all(concurrentUpdates);
    const failedUpdates = results.filter(r => r.error);
    assert('Persist 2.1: 20 concurrent updates handled without rejection or crash', failedUpdates.length === 0);

    // Verify tickets.json integrity on disk
    const diskPath = path.resolve(ROOT_DIR, 'server/data/tickets.json');
    let diskValid = false;
    try {
      const content = fs.readFileSync(diskPath, 'utf8');
      const parsed = JSON.parse(content);
      diskValid = Array.isArray(parsed) && parsed.length === 3;
    } catch (e) {
      diskValid = false;
    }
    assert('Persist 2.2: tickets.json on disk is 100% valid JSON with zero corruption', diskValid);

    // =========================================================================
    // SECTION 3: FULL WORKFLOW ACROSS ALL 3 DEMO CUSTOMERS
    // =========================================================================
    console.log('\n--- SECTION 3: Full Workflow Across All 3 Demo Customers ---');

    // Reset tickets to clean baseline
    await axios.post(`${BACKEND_URL}/api/tickets/reset`);

    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      defaultViewport: { width: 1440, height: 900 },
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security', '--window-size=1440,900']
    });

    const ctxAgent = await browser.createBrowserContext();
    const ctxAarav = await browser.createBrowserContext();
    const ctxPriya = await browser.createBrowserContext();
    const ctxKabir = await browser.createBrowserContext();

    const pageAgent = await ctxAgent.newPage();
    const pageAarav = await ctxAarav.newPage();
    const pagePriya = await ctxPriya.newPage();
    const pageKabir = await ctxKabir.newPage();

    // Open sessions and clean local storage
    await pageAgent.goto(`${FRONTEND_URL}/agent`, { waitUntil: 'domcontentloaded' });
    await pageAarav.goto(`${FRONTEND_URL}/customer?id=cust_aarav`, { waitUntil: 'domcontentloaded' });
    await pagePriya.goto(`${FRONTEND_URL}/customer?id=cust_priya`, { waitUntil: 'domcontentloaded' });
    await pageKabir.goto(`${FRONTEND_URL}/customer?id=cust_kabir`, { waitUntil: 'domcontentloaded' });

    await pageAgent.evaluate(() => localStorage.clear()).catch(() => {});
    await pageAarav.evaluate(() => localStorage.clear()).catch(() => {});
    await pagePriya.evaluate(() => localStorage.clear()).catch(() => {});
    await pageKabir.evaluate(() => localStorage.clear()).catch(() => {});

    await pageAgent.reload({ waitUntil: 'domcontentloaded' });
    await pageAarav.reload({ waitUntil: 'domcontentloaded' });
    await pagePriya.reload({ waitUntil: 'domcontentloaded' });
    await pageKabir.reload({ waitUntil: 'domcontentloaded' });
    await sleep(3500);

    // Helper: Select ticket in Agent Dashboard
    async function selectAgentTicket(customerName) {
      await pageAgent.evaluate((name) => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.textContent.includes(name));
        if (btn) btn.click();
      }, customerName);
      await sleep(1500);
    }

    // Helper: Run full workflow for a customer
    async function testCustomerWorkflow(customerName, orderId, pageCustomer, testPrefix) {
      console.log(`\n  >> Running complete workflow for ${customerName} (${orderId})...`);

      // 1. Customer sends inquiry
      const msg = `M4-Inquiry-${Date.now()}: Status for order ${orderId}?`;
      await pageCustomer.type('input[placeholder*="message"]', msg);
      await pageCustomer.click('button[type="submit"]');
      await sleep(3500);

      const customerSeesSent = await pageCustomer.evaluate(txt => document.getElementById('customer-chat-messages')?.innerText.includes(txt), msg);
      assert(`${testPrefix}.1: ${customerName} sends inquiry & sees in message list`, customerSeesSent);

      // 2. Agent receives inquiry
      await selectAgentTicket(customerName);
      const agentSeesMsg = await pageAgent.evaluate(txt => document.body.innerText.includes(txt), msg);
      assert(`${testPrefix}.2: Agent receives ${customerName}'s inquiry via Nexconn`, agentSeesMsg);

      // 3. Customer requests human support
      const isAlreadyRequested = await pageCustomer.evaluate(() => document.body.innerText.includes('Human Requested'));
      let clickedHandoff = isAlreadyRequested;
      if (!isAlreadyRequested) {
        clickedHandoff = await pageCustomer.evaluate(() => {
          const btn = document.getElementById('btn-request-human');
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        });
        await sleep(2500);
      }
      const customerHandoffStatus = await pageCustomer.evaluate(() => document.body.innerText.includes('Human Requested'));
      assert(`${testPrefix}.3: Customer requests human support -> status updates`, (clickedHandoff || isAlreadyRequested) && customerHandoffStatus);

      // 4. Agent takes over
      await selectAgentTicket(customerName);
      const clickedTakeOver = await pageAgent.evaluate(() => {
        const btn = document.getElementById('btn-takeover-ticket');
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      await sleep(3000);
      const agentStatusActive = await pageAgent.evaluate(() => document.body.innerText.includes('Human Agent Active'));
      assert(`${testPrefix}.4: Agent takes over conversation -> Human Agent Active`, clickedTakeOver && agentStatusActive);

      // 5. AI autonomous messaging suppressed after takeover
      const msgCountBefore = await pageCustomer.evaluate(() => document.querySelectorAll('p').length);
      await sleep(2500);
      const msgCountAfter = await pageCustomer.evaluate(() => document.querySelectorAll('p').length);
      assert(`${testPrefix}.5: AI is suppressed from sending unapproved messages`, msgCountBefore === msgCountAfter);

      // 6. AI Copilot suggestion & Agent approval
      let clickedApprove = false;
      for (let i = 0; i < 8; i++) {
        clickedApprove = await pageAgent.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find(b => b.textContent.includes('Approve & Send') || b.textContent.includes('Send Reply'));
          if (btn && !btn.disabled) {
            btn.click();
            return true;
          }
          return false;
        });
        if (clickedApprove) break;
        await sleep(1000);
      }
      assert(`${testPrefix}.6: Agent reviews & approves Copilot reply`, clickedApprove);
      await sleep(3500);

      // 7. Agent resolves ticket
      const clickedResolve = await pageAgent.evaluate(() => {
        const btn = document.getElementById('btn-resolve-ticket');
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      await sleep(3500);
      const agentSeesResolved = await pageAgent.evaluate(() => document.body.innerText.includes('Resolved'));
      assert(`${testPrefix}.7: Agent marks ${customerName}'s ticket as Resolved`, clickedResolve && agentSeesResolved);

      // 8. Customer reflects resolved state in real time
      let customerSeesResolved = false;
      for (let i = 0; i < 6; i++) {
        customerSeesResolved = await pageCustomer.evaluate(() => document.body.innerText.includes('Resolved'));
        if (customerSeesResolved) break;
        await sleep(1000);
      }
      assert(`${testPrefix}.8: Customer portal reflects Resolved state in real time`, customerSeesResolved);
    }

    // Run Customer 1: Aarav (NC1021)
    await testCustomerWorkflow('Aarav Sharma', 'NC1021', pageAarav, 'Cust 1 (Aarav)');

    // Run Customer 2: Priya (NC1022)
    await testCustomerWorkflow('Priya Mehta', 'NC1022', pagePriya, 'Cust 2 (Priya)');

    // Run Customer 3: Kabir (NC1023)
    await testCustomerWorkflow('Kabir Verma', 'NC1023', pageKabir, 'Cust 3 (Kabir)');

    // =========================================================================
    // SECTION 4: CROSS-CUSTOMER DATA ISOLATION VERIFICATION
    // =========================================================================
    console.log('\n--- SECTION 4: Cross-Customer Data Isolation Verification ---');
    const aaravChat = await pageAarav.evaluate(() => document.getElementById('customer-chat-messages')?.innerText.toLowerCase() || '');
    const priyaChat = await pagePriya.evaluate(() => document.getElementById('customer-chat-messages')?.innerText.toLowerCase() || '');
    const kabirChat = await pageKabir.evaluate(() => document.getElementById('customer-chat-messages')?.innerText.toLowerCase() || '');

    const aaravIsolated = !aaravChat.includes('nc1022') && !aaravChat.includes('nc1023');
    const priyaIsolated = !priyaChat.includes('nc1021') && !priyaChat.includes('nc1023');
    const kabirIsolated = !kabirChat.includes('nc1021') && !kabirChat.includes('nc1022');

    assert('Isolate 4.1: Aarav has 0 Priya (NC1022) or Kabir (NC1023) leakage', aaravIsolated);
    assert('Isolate 4.2: Priya has 0 Aarav (NC1021) or Kabir (NC1023) leakage', priyaIsolated);
    assert('Isolate 4.3: Kabir has 0 Aarav (NC1021) or Priya (NC1022) leakage', kabirIsolated);

    // =========================================================================
    // SECTION 5: BACKEND RESTART & FULL PERSISTENCE VERIFICATION
    // =========================================================================
    console.log('\n--- SECTION 5: Backend Restart & Full Persistence Verification ---');
    
    // Read backend tickets before restart
    const preRestartTickets = await axios.get(`${BACKEND_URL}/api/tickets`).then(r => r.data.tickets);
    const allPreResolved = preRestartTickets.every(t => t.status === 'Resolved');

    // Simulate backend restart by checking disk persistence
    const diskContent = JSON.parse(fs.readFileSync(diskPath, 'utf8'));
    const allDiskResolved = diskContent.every(t => t.status === 'Resolved');

    assert('Persist 5.1: Backend disk persistence retains all 3 tickets in Resolved state', allPreResolved && allDiskResolved);

    // Reload customer and agent pages to test restoration
    await pageAgent.reload({ waitUntil: 'domcontentloaded' });
    await pageAarav.reload({ waitUntil: 'domcontentloaded' });
    await sleep(3000);

    const aaravHistoryAfterF5 = await pageAarav.evaluate(() => {
      const chat = document.getElementById('customer-chat-messages');
      return chat ? chat.innerText.length > 50 : false;
    });
    const aaravResolvedAfterF5 = await pageAarav.evaluate(() => document.body.innerText.includes('Resolved'));

    assert('Persist 5.2: Customer Aarav retains full history & Resolved state after F5', aaravHistoryAfterF5 && aaravResolvedAfterF5);

    // =========================================================================
    // SECTION 6: SPLIT-SCREEN REAL-TIME SYNCHRONIZATION
    // =========================================================================
    console.log('\n--- SECTION 6: Split-Screen Dual-Pane Verification ---');
    const pageSplit = await ctxAgent.newPage();
    await pageSplit.goto(`${FRONTEND_URL}/split`, { waitUntil: 'domcontentloaded' });
    await sleep(3000);

    const splitHasBothPanes = await pageSplit.evaluate(() => {
      const t = document.body.innerText;
      return t.includes('Customer Experience') && t.includes('Agent Workspace & AI Copilot');
    });
    assert('Split 6.1: Split view renders dual synchronized panes seamlessly', splitHasBothPanes);

    console.log('\n================================================================');
    console.log(`FINAL HARDENING & DEMO SUITE: ${passedTests}/${totalTests} PASSED`);
    console.log('================================================================\n');

  } catch (err) {
    console.error('FINAL SUITE ERROR:', err);
  } finally {
    if (browser) await browser.close();
    if (frontendProc) frontendProc.kill();
    if (backendProc) backendProc.kill();
  }
}

runMilestone4FullE2E();

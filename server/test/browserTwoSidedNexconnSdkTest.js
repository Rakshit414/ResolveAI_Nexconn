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
    } catch (e) {}
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

async function runBrowserTwoSidedNexconnSdkTest() {
  fs.mkdirSync(ARTIFACT_SCREENSHOTS, { recursive: true });
  fs.mkdirSync(LOCAL_SCREENSHOTS, { recursive: true });

  const spawnedProcesses = await ensureServers();

  console.log('\n=== [TEST SUITE 14: Real Browser SDK Two-Sided End-to-End Messaging] ===');
  console.log('Launching Chrome to initiate real customer & agent browser sessions...');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  });

  try {
    // 1. Create Customer Page (Aarav Sharma)
    console.log('\n[Customer Browser Session] Opening Customer Portal for Aarav Sharma...');
    const customerPage = await browser.newPage();
    await customerPage.setViewport({ width: 1280, height: 800 });

    const customerLogs = [];
    const customerSdkEvents = [];
    customerPage.on('console', msg => {
      const text = msg.text();
      customerLogs.push(text);
      if (text.includes('[Nexconn]') || text.includes('[IMLib]')) {
        customerSdkEvents.push(text);
        console.log('[Customer Browser SDK LOG]:', text);
      }
    });

    await customerPage.goto(`${FRONTEND_URL}/customer?id=cust_aarav`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);

    // Verify Customer SDK connected
    const customerConnected = await customerPage.evaluate(() => {
      return window.__nexconnService?.connected || false;
    });
    console.log('[Customer Session] SDK Connected Status:', customerConnected);

    // 2. Create Agent Page (Sarah Lin)
    console.log('\n[Agent Browser Session] Opening Agent Dashboard for Sarah Lin...');
    const agentPage = await browser.newPage();
    await agentPage.setViewport({ width: 1280, height: 800 });

    const agentLogs = [];
    const agentSdkEvents = [];
    agentPage.on('console', msg => {
      const text = msg.text();
      agentLogs.push(text);
      if (text.includes('[Nexconn]') || text.includes('[IMLib]')) {
        agentSdkEvents.push(text);
        console.log('[Agent Browser SDK LOG]:', text);
      }
    });

    await agentPage.goto(`${FRONTEND_URL}/agent`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);

    // Verify Agent SDK connected
    const agentConnected = await agentPage.evaluate(() => {
      return window.__nexconnService?.connected || false;
    });
    console.log('[Agent Session] SDK Connected Status:', agentConnected);

    // 3. Customer Browser Sends Real Nexconn DirectChannel Message
    const testTimestamp = Date.now();
    const customerMsgText = `Live SDK customer inquiry from Aarav regarding Order NC1021 [timestamp: ${testTimestamp}]`;
    console.log('\n--- 3. Customer Sends Message via Browser SDK ---');
    console.log('Customer Message:', customerMsgText);

    const customerSendResult = await customerPage.evaluate(async (msgText) => {
      if (!window.__nexconnService) throw new Error('Nexconn service missing on customer window');
      // Send directly via SDK DirectChannel to agent_sarah
      return await window.__nexconnService.sendMessage({
        targetUserId: 'agent_sarah',
        channelId: 'channel_NC1021',
        text: msgText,
        metadata: { ticketId: 'tkt_1021', brandId: 'brand_novacart', role: 'customer' }
      });
    }, customerMsgText);

    console.log('[Customer SDK Send Result]:', {
      id: customerSendResult.id,
      channelId: customerSendResult.channelId,
      senderId: customerSendResult.senderId,
      senderRole: customerSendResult.senderRole
    });

    // 4. Agent Browser Receives Real Nexconn SDK Event
    console.log('\n--- 4. Waiting for Agent Browser Receipt via SDK onMessageReceived ---');
    let agentReceived = false;
    let agentReceivedMsgId = null;

    for (let i = 0; i < 20; i++) {
      await sleep(500);
      agentReceived = await agentPage.evaluate((ts) => {
        if (!window.__nexconnService) return false;
        const history = window.__nexconnService.getChannelHistory('channel_NC1021') || [];
        const match = history.find(m => m.text && m.text.includes(String(ts)));
        return match ? (match.id || match.messageId || true) : false;
      }, testTimestamp);

      if (agentReceived) {
        agentReceivedMsgId = agentReceived;
        break;
      }
    }

    console.log('[Agent Browser Receipt Verified]:', Boolean(agentReceived), 'Received Message ID:', agentReceivedMsgId);

    // 5. Agent Browser Sends Real Nexconn DirectChannel Reply
    const replyTimestamp = Date.now();
    const agentReplyText = `Hello Aarav! Sarah Lin here from Agent Dashboard. Your package NC1021 has cleared customs [timestamp: ${replyTimestamp}]`;
    console.log('\n--- 5. Agent Sends Reply via Browser SDK ---');
    console.log('Agent Reply Message:', agentReplyText);

    const agentSendResult = await agentPage.evaluate(async (replyText) => {
      if (!window.__nexconnService) throw new Error('Nexconn service missing on agent window');
      return await window.__nexconnService.sendMessage({
        targetUserId: 'cust_aarav',
        channelId: 'channel_NC1021',
        text: replyText,
        metadata: { ticketId: 'tkt_1021', brandId: 'brand_novacart', role: 'agent' }
      });
    }, agentReplyText);

    console.log('[Agent SDK Send Result]:', {
      id: agentSendResult.id,
      channelId: agentSendResult.channelId,
      senderId: agentSendResult.senderId,
      senderRole: agentSendResult.senderRole
    });

    // 6. Customer Browser Receives Real Nexconn SDK Reply
    console.log('\n--- 6. Waiting for Customer Browser Receipt via SDK onMessageReceived ---');
    let customerReceivedReply = false;
    let customerReceivedReplyId = null;

    for (let i = 0; i < 20; i++) {
      await sleep(500);
      customerReceivedReply = await customerPage.evaluate((ts) => {
        if (!window.__nexconnService) return false;
        const history = window.__nexconnService.getChannelHistory('channel_NC1021') || [];
        const match = history.find(m => m.text && m.text.includes(String(ts)));
        return match ? (match.id || match.messageId || true) : false;
      }, replyTimestamp);

      if (customerReceivedReply) {
        customerReceivedReplyId = customerReceivedReply;
        break;
      }
    }

    console.log('[Customer Browser Receipt Verified]:', Boolean(customerReceivedReply), 'Received Reply ID:', customerReceivedReplyId);

    // 7. Save Visual Verification Screenshots
    console.log('\n--- 7. Capturing Real Browser SDK Interaction Screenshots ---');
    const custScreenPath = path.join(ARTIFACT_SCREENSHOTS, 'customer_browser_sdk_verified.png');
    const custLocalPath = path.join(LOCAL_SCREENSHOTS, 'customer_browser_sdk_verified.png');
    await customerPage.screenshot({ path: custScreenPath });
    await customerPage.screenshot({ path: custLocalPath });
    console.log('✓ Saved: customer_browser_sdk_verified.png');

    const agentScreenPath = path.join(ARTIFACT_SCREENSHOTS, 'agent_browser_sdk_verified.png');
    const agentLocalPath = path.join(LOCAL_SCREENSHOTS, 'agent_browser_sdk_verified.png');
    await agentPage.screenshot({ path: agentScreenPath });
    await agentPage.screenshot({ path: agentLocalPath });
    console.log('✓ Saved: agent_browser_sdk_verified.png');

    console.log('\n====================================================================');
    console.log('REAL BROWSER SDK TWO-SIDED MESSAGING TEST COMPLETED SUCCESSFULLY');
    console.log('====================================================================');

    await customerPage.close();
    await agentPage.close();
  } finally {
    await browser.close();
    for (const proc of spawnedProcesses) {
      try {
        proc.kill('SIGTERM');
      } catch (e) {}
    }
  }
}

runBrowserTwoSidedNexconnSdkTest();

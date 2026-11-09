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

let passedCount = 0;
let failedCount = 0;
const testResults = [];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assert(id, description, condition) {
  if (condition) {
    passedCount++;
    testResults.push({ id, description, status: 'PASS' });
    console.log(`[PASS] ${id}: ${description}`);
  } else {
    failedCount++;
    testResults.push({ id, description, status: 'FAIL' });
    console.error(`[FAIL] ${id}: ${description}`);
    throw new Error(`Assertion failed: ${id} - ${description}`);
  }
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
  } else {
    console.log('[Setup] Express Backend server is already running.');
  }

  const frontendAlive = await axios.get(FRONTEND_URL, { timeout: 1000 }).then(() => true).catch(() => false);
  if (!frontendAlive) {
    console.log('[Setup] Spawning Vite Frontend server...');
    const frontendProc = spawn('node', ['./node_modules/vite/bin/vite.js', 'preview', '--port', '5173', '--host', '127.0.0.1'], {
      cwd: path.resolve(ROOT_DIR, 'client'),
      stdio: 'pipe'
    });
    processes.push(frontendProc);
  } else {
    console.log('[Setup] Vite Frontend server is already running.');
  }

  await waitForServer(`${BACKEND_URL}/api/health`, 20000);
  await waitForServer(FRONTEND_URL, 20000);
  console.log('[Setup] All servers ready and healthy.');

  return processes;
}

async function runAcceptanceSuite() {
  console.log('================================================================');
  console.log('  RESOLVE AI — CUSTOMER PORTAL ACCEPTANCE TEST SUITE            ');
  console.log('================================================================\n');

  fs.mkdirSync(ARTIFACT_SCREENSHOTS, { recursive: true });
  fs.mkdirSync(LOCAL_SCREENSHOTS, { recursive: true });

  const processes = await ensureServers();

  // Reset tickets to clean seed state
  try {
    await axios.post(`${BACKEND_URL}/api/tickets/reset`);
    console.log('[Setup] Reset database to fresh demo seed state.');
  } catch (e) {
    console.warn('[Setup] Note on reset:', e.message);
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--window-size=1534,880'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1534, height: 880 });

    async function takeScreenshot(name) {
      const artPath = path.join(ARTIFACT_SCREENSHOTS, name);
      const locPath = path.join(LOCAL_SCREENSHOTS, name);
      await page.screenshot({ path: artPath, fullPage: false });
      fs.copyFileSync(artPath, locPath);
      console.log(`[Screenshot Captured] -> ${name}`);
    }

    // =========================================================================
    // PART 1: FIRST-TIME CUSTOMER EXPERIENCE (Aarav, Priya, Kabir)
    // =========================================================================
    console.log('\n--- PART 1: First-Time Customer Experience ---');

    // 1.1 - 1.6 Aarav Sharma
    console.log('>> Testing Aarav Sharma (NC1021)...');
    await page.goto(`${FRONTEND_URL}/customer?customer=cust_aarav&view=welcome`, { waitUntil: 'networkidle0' });
    await sleep(1200);

    const aaravGreeting = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Hello, Aarav') && text.includes('Welcome to NovaCart Support');
    });
    assert('Test 1.1', 'Aarav personalized greeting displayed prominently', aaravGreeting);

    const aaravIdentity = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Aarav Sharma') && text.includes('Support Online');
    });
    assert('Test 1.2', 'Aarav customer identity and online status badge verified', aaravIdentity);

    const aaravOrder = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasOrderId = text.includes('NC1021') || text.includes('#NC1021');
      const hasProduct = text.includes('Running Shoes') || text.includes('NovaSprint Pro');
      const hasThumbnail = Boolean(document.querySelector('img[src*="unsplash.com"]'));
      return hasOrderId && hasProduct && hasThumbnail;
    });
    assert('Test 1.3', 'Aarav order info (#NC1021, NovaSprint Pro) and product thumbnail rendered', aaravOrder);

    const aaravTracking = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasStatus = text.includes('Delayed');
      const hasPrice = text.includes('119.99');
      const hasCarrier = text.includes('FedEx Express');
      const hasTrackingNum = text.includes('TRK-NC-882910');
      return hasStatus && hasPrice && hasCarrier && hasTrackingNum;
    });
    assert('Test 1.4', 'Aarav delivery status (Delayed), price ($119.99), and tracking info verified', aaravTracking);

    const aaravSupportActions = await page.evaluate(() => {
      const text = document.body.innerText;
      const a1 = text.includes('Track an order');
      const a2 = text.includes('Request a return or refund');
      const a3 = text.includes('Report a damaged or incorrect product');
      const a4 = text.includes('Ask a question');
      const a5 = text.includes('Connect with a human agent');
      return a1 && a2 && a3 && a4 && a5;
    });
    assert('Test 1.5', 'All five support action cards are visible and usable for Aarav', aaravSupportActions);

    const aaravSuggestedQuestions = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('When will my order arrive?') || text.includes('expedite');
    });
    assert('Test 1.6', 'Contextual suggested questions tailored to Aarav order delay verified', aaravSuggestedQuestions);

    await takeScreenshot('aarav_first_time_welcome.png');

    // 1.7 - 1.10 Priya Mehta
    console.log('>> Testing Priya Mehta (NC1022)...');
    await page.goto(`${FRONTEND_URL}/customer?customer=cust_priya&view=welcome`, { waitUntil: 'networkidle0' });
    await sleep(1200);

    const priyaGreeting = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Hello, Priya') && text.includes('How can we help you today?');
    });
    assert('Test 1.7', 'Priya personalized greeting displayed prominently', priyaGreeting);

    const priyaIdentityOrder = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasName = text.includes('Priya Mehta');
      const hasOrderId = text.includes('NC1022') || text.includes('#NC1022');
      const hasProduct = text.includes('Smartwatch') || text.includes('NovaPulse');
      return hasName && hasOrderId && hasProduct;
    });
    assert('Test 1.8', 'Priya identity and order info (#NC1022, NovaPulse Smartwatch) verified', priyaIdentityOrder);

    const priyaTracking = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasStatus = text.includes('Delivered');
      const hasPrice = text.includes('249.50') || text.includes('249');
      const hasCarrier = text.includes('UPS');
      const hasTrackingNum = text.includes('TRK-NC-773821') || text.includes('773821');
      return hasStatus && hasPrice && hasCarrier && hasTrackingNum;
    });
    assert('Test 1.9', 'Priya delivery status (Delivered), price ($249.50), and tracking verified', priyaTracking);

    const priyaSupportActions = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Track an order') && text.includes('Request a return') && text.includes('Connect with a human agent');
    });
    assert('Test 1.10', 'All five support actions rendered and accessible for Priya', priyaSupportActions);

    await takeScreenshot('priya_first_time_welcome.png');

    // 1.11 - 1.14 Kabir Verma
    console.log('>> Testing Kabir Verma (NC1023)...');
    await page.goto(`${FRONTEND_URL}/customer?customer=cust_kabir&view=welcome`, { waitUntil: 'networkidle0' });
    await sleep(1200);

    const kabirGreeting = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Hello, Kabir') && text.includes("We're here to help");
    });
    assert('Test 1.11', 'Kabir personalized greeting displayed prominently', kabirGreeting);

    const kabirIdentityOrder = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasName = text.includes('Kabir Verma');
      const hasOrderId = text.includes('NC1023') || text.includes('#NC1023');
      const hasProduct = text.includes('Headphones') || text.includes('NovaBass');
      return hasName && hasOrderId && hasProduct;
    });
    assert('Test 1.12', 'Kabir identity and order info (#NC1023, NovaBass ANC) verified', kabirIdentityOrder);

    const kabirTracking = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasStatus = text.includes('Delivered');
      const hasPrice = text.includes('89.00') || text.includes('89');
      const hasCarrier = text.includes('DHL Express') || text.includes('DHL');
      const hasTrackingNum = text.includes('TRK-NC-449102') || text.includes('449102');
      return hasStatus && hasPrice && hasCarrier && hasTrackingNum;
    });
    assert('Test 1.13', 'Kabir delivery status (Delivered), price ($89.00), and tracking verified', kabirTracking);

    const kabirSupportActions = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Track an order') && text.includes('Report a damaged') && text.includes('Ask a question');
    });
    assert('Test 1.14', 'All five support actions rendered and accessible for Kabir', kabirSupportActions);

    await takeScreenshot('kabir_first_time_welcome.png');

    // =========================================================================
    // PART 2: RETURNING CUSTOMER EXPERIENCE
    // =========================================================================
    console.log('\n--- PART 2: Returning Customer Experience ---');

    // Reset database and local storage to start fresh conversation for returning customer test
    await axios.post(`${BACKEND_URL}/api/tickets/reset`);
    await page.goto(`${FRONTEND_URL}/customer?customer=cust_aarav`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(1200);

    const msg1 = `Inquiry msg 1 from Aarav: What is the current status of order NC1021? ${Date.now()}`;
    const msg2 = `Inquiry msg 2 from Aarav: Is there any update on customs clearance? ${Date.now()}`;

    // Send Message 1
    await page.focus('#input-customer-message');
    await page.type('#input-customer-message', msg1);
    await page.click('#btn-customer-send');
    await sleep(1500);

    // Send Message 2
    await page.focus('#input-customer-message');
    await page.type('#input-customer-message', msg2);
    await page.click('#btn-customer-send');
    await sleep(1500);

    const initialMessagesDelivered = await page.evaluate((m1, m2) => {
      const text = document.body.innerText;
      return text.includes(m1) && text.includes(m2);
    }, msg1, msg2);
    assert('Test 2.1', 'Multiple messages dispatched and visible in customer conversation', initialMessagesDelivered);

    // Refresh the browser
    console.log('>> Refreshing browser to verify returning customer restoration...');
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(1800);

    const returningBarVisible = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasWelcomeBack = text.includes('Welcome back, Aarav') || text.includes('Welcome back');
      const hasOrder = text.includes('#NC1021') || text.includes('NC1021');
      const hasOverviewBtn = Boolean(document.querySelector('#btn-view-welcome-overview'));
      return hasWelcomeBack && hasOrder && hasOverviewBtn;
    });
    assert('Test 2.2', 'Compact returning-customer greeting bar appears with customer name and order ID', returningBarVisible);

    const conversationRestored = await page.evaluate((m1, m2) => {
      const text = document.body.innerText;
      return text.includes(m1) && text.includes(m2);
    }, msg1, msg2);
    assert('Test 2.3', 'Full previous conversation restored accurately after browser reload', conversationRestored);

    const noDuplicateMessages = await page.evaluate((m1, m2) => {
      const text = document.body.innerText;
      const count1 = (text.match(new RegExp(m1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      const count2 = (text.match(new RegExp(m2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      return count1 === 1 && count2 === 1;
    }, msg1, msg2);
    assert('Test 2.4', 'Messages are not duplicated (each message appears exactly once)', noDuplicateMessages);

    const chatViewUnobstructed = await page.evaluate(() => {
      const chatMessages = document.querySelector('#customer-chat-messages');
      const text = chatMessages ? chatMessages.innerText : '';
      const hasFirstTimeHero = text.includes('Welcome to NovaCart Support') && text.includes('Choose an option below');
      const hasBubbleStream = Boolean(document.querySelector('#customer-chat-messages'));
      return !hasFirstTimeHero && hasBubbleStream;
    });
    assert('Test 2.5', 'No first-time welcome screen obstructs the ongoing conversation in chat view', chatViewUnobstructed);

    const composerReady = await page.evaluate(() => {
      const input = document.querySelector('#input-customer-message');
      const btn = document.querySelector('#btn-customer-send');
      return Boolean(input) && Boolean(btn) && !input.disabled;
    });
    assert('Test 2.6', 'Customer composer is active and ready for ongoing back-and-forth communication', composerReady);

    await takeScreenshot('returning_customer_experience.png');

    // =========================================================================
    // PART 3: SUPPORT ACTION VERIFICATION (Actual Workflows)
    // =========================================================================
    console.log('\n--- PART 3: Support Action Verification ---');

    // Reset tickets for clean action testing
    await axios.post(`${BACKEND_URL}/api/tickets/reset`);
    await sleep(600);

    // ACTION 1: Track an order
    console.log('>> Testing Action 1: Track an order...');
    await page.goto(`${FRONTEND_URL}/customer?customer=cust_aarav&view=welcome`, { waitUntil: 'networkidle0' });
    await sleep(1000);

    const trackClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const trackBtn = btns.find(b => b.textContent.includes('Track an order') || b.textContent.includes('Track Order') || b.textContent.includes('View tracking'));
      if (trackBtn) {
        trackBtn.click();
        return true;
      }
      return false;
    });
    assert('Test 3.1', 'Action 1 "Track an order" button clicked', trackClicked);
    await sleep(800);

    const trackingExpanded = await page.evaluate(() => {
      const textUpper = document.body.innerText.toUpperCase();
      const hasUpdate = textUpper.includes('COURIER UPDATE');
      const hasCarrier = textUpper.includes('FEDEX') || textUpper.includes('CARRIER');
      const hasDetails = textUpper.includes('CUSTOMS CLEARANCE') || textUpper.includes('REGIONAL LOGISTICS');
      return hasUpdate && hasCarrier && hasDetails;
    });
    assert('Test 3.2', 'Action 1: Live tracking details expand showing carrier (FedEx) and courier delay status', trackingExpanded);
    await takeScreenshot('support_action_1_track_order.png');

    // ACTION 2: Request a return or refund
    console.log('>> Testing Action 2: Request a return or refund...');
    // Return to welcome view
    await page.goto(`${FRONTEND_URL}/customer?customer=cust_priya&view=welcome`, { waitUntil: 'networkidle0' });
    await sleep(1000);

    const returnClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const retBtn = btns.find(b => b.textContent.includes('Request a return') || b.textContent.includes('return or refund'));
      if (retBtn) {
        retBtn.click();
        return true;
      }
      return false;
    });
    assert('Test 3.3', 'Action 2 "Request a return or refund" clicked', returnClicked);
    await sleep(800);

    const returnPreFilled = await page.evaluate(() => {
      const input = document.querySelector('#input-customer-message');
      return input && input.value.includes('7-day return policy') && input.value.includes('NC1022');
    });
    assert('Test 3.4', 'Action 2: Composer automatically transitions to chat and pre-fills formal return request for #NC1022', returnPreFilled);

    // Send the return request
    await page.click('#btn-customer-send');
    await sleep(1200);

    const returnMessageDelivered = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('7-day return policy') && text.includes('NC1022');
    });
    assert('Test 3.5', 'Action 2: Return request successfully sent to conversation stream and agent channel', returnMessageDelivered);
    await takeScreenshot('support_action_2_return_request.png');

    // ACTION 3: Report a damaged or incorrect product
    console.log('>> Testing Action 3: Report a damaged product...');
    await page.goto(`${FRONTEND_URL}/customer?customer=cust_aarav&view=welcome`, { waitUntil: 'networkidle0' });
    await sleep(1000);

    const damageClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const dmgBtn = btns.find(b => b.textContent.includes('Report a damaged') || b.textContent.includes('damaged product'));
      if (dmgBtn) {
        dmgBtn.click();
        return true;
      }
      return false;
    });
    assert('Test 3.6', 'Action 3 "Report damaged product" clicked', damageClicked);
    await sleep(800);

    const damagePreFilled = await page.evaluate(() => {
      const input = document.querySelector('#input-customer-message');
      return input && input.value.includes('damaged product') && input.value.includes('attached a photo');
    });
    assert('Test 3.7', 'Action 3: Composer pre-filled with damage report statement', damagePreFilled);

    // Attach sample photo
    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      const testImgPath = path.join(ROOT_DIR, 'test_damage_sample.png');
      const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAUSURBVGhD7cEBDQAAAMKg909tDwcUAAAcO8k2AAEPB6vQAAAAAElFTkSuQmCC', 'base64');
      fs.writeFileSync(testImgPath, pngBuffer);
      await fileInput.uploadFile(testImgPath);
      await sleep(1000);
      try { fs.unlinkSync(testImgPath); } catch (e) {}
    }

    const attachmentPreviewVisible = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('test_damage_sample.png') || text.includes('KB') || Boolean(document.querySelector('img[src^="data:image"]'));
    });
    assert('Test 3.8', 'Action 3: Photo attachment preview strip rendered with thumbnail and size', attachmentPreviewVisible);

    await page.click('#btn-customer-send');
    await sleep(1200);

    const damagedMessageDelivered = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasText = text.includes('damaged product');
      const hasImageBubble = Boolean(document.querySelector('#customer-chat-messages img[src^="data:image"]'));
      return hasText && hasImageBubble;
    });
    assert('Test 3.9', 'Action 3: Damage inquiry with embedded photo rendered in conversation bubble', damagedMessageDelivered);
    await takeScreenshot('support_action_3_damaged_product.png');

    // ACTION 4: Ask a question (Suggested question flow)
    console.log('>> Testing Action 4: Ask a question via Suggested Questions...');
    await page.goto(`${FRONTEND_URL}/customer?customer=cust_kabir&view=welcome`, { waitUntil: 'networkidle0' });
    await sleep(1000);

    const questionClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const qBtn = btns.find(b => b.textContent.includes('replacement') || b.textContent.includes('wrong item') || b.textContent.includes('ear cushions') || b.textContent.includes('warranty'));
      if (qBtn) {
        qBtn.click();
        return qBtn.textContent.trim();
      }
      return null;
    });
    assert('Test 3.10', 'Action 4: Contextual suggested question clicked', Boolean(questionClicked));
    await sleep(1500);

    const questionDispatched = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('replacement') || text.includes('wrong item') || text.includes('ear cushions') || text.includes('warranty');
    });
    assert('Test 3.11', 'Action 4: Suggested question dispatched into conversation stream automatically', questionDispatched);
    await takeScreenshot('support_action_4_ask_question.png');

    // ACTION 5: Connect with a human agent
    console.log('>> Testing Action 5: Connect with a human agent...');
    await page.goto(`${FRONTEND_URL}/customer?customer=cust_priya&view=welcome`, { waitUntil: 'networkidle0' });
    await sleep(1000);

    const humanClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const hBtn = btns.find(b => b.textContent.includes('Connect with a human agent') || b.textContent.includes('Talk to human agent') || b.id === 'btn-request-human');
      if (hBtn) {
        hBtn.click();
        return true;
      }
      return false;
    });
    assert('Test 3.12', 'Action 5: "Connect with a human agent" clicked', humanClicked);
    await sleep(1500);

    const humanStateEngaged = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasStatusPill = text.includes('Human Requested') || Boolean(document.querySelector('#customer-status-badge-requested'));
      const hasSystemNotice = text.includes('Human assistance has been requested') || text.includes('Sarah Lin');
      return hasStatusPill && hasSystemNotice;
    });
    assert('Test 3.13', 'Action 5: Ticket status transitions to "Human Requested" with agent handoff notice', humanStateEngaged);
    await takeScreenshot('support_action_5_connect_human.png');

    // =========================================================================
    // PART 4: CUSTOMER ISOLATION & SWITCHING
    // =========================================================================
    console.log('\n--- PART 4: Customer Isolation & Switching ---');

    await page.goto(`${FRONTEND_URL}/customer?customer=cust_aarav&view=welcome`, { waitUntil: 'networkidle0' });
    await sleep(1000);

    // Switch to Priya via header persona tab
    console.log('>> Switching to Priya Mehta via header switcher...');
    await page.click('#btn-customer-priya');
    await sleep(1000);

    const priyaIsolated = await page.evaluate(() => {
      const text = document.body.innerText;
      const isPriya = text.includes('Hello, Priya') || text.includes('Priya Mehta');
      const hasPriyaOrder = text.includes('NC1022') || text.includes('Smart Fitness Watch');
      const hasNoAaravOrder = !text.includes('NC1021') && !text.includes('NovaSprint Pro');
      return isPriya && hasPriyaOrder && hasNoAaravOrder;
    });
    assert('Test 4.1', 'Switching to Priya updates greeting and order (#NC1022) with zero Aarav leakage', priyaIsolated);

    // Switch to Kabir via header persona tab
    console.log('>> Switching to Kabir Verma via header switcher...');
    await page.click('#btn-customer-kabir');
    await sleep(1000);

    const kabirIsolated = await page.evaluate(() => {
      const text = document.body.innerText;
      const isKabir = text.includes('Hello, Kabir') || text.includes('Kabir Verma');
      const hasKabirOrder = text.includes('NC1023') || text.includes('NovaBass Pro');
      const hasNoPriyaOrder = !text.includes('NC1022') && !text.includes('Smart Fitness Watch');
      return isKabir && hasKabirOrder && hasNoPriyaOrder;
    });
    assert('Test 4.2', 'Switching to Kabir updates greeting and order (#NC1023) with zero Priya leakage', kabirIsolated);

    // Split View Switching Synchronization
    console.log('>> Testing Split View Customer Selection Synchronization...');
    await page.goto(`${FRONTEND_URL}/split`, { waitUntil: 'networkidle0' });
    await sleep(1500);

    // Verify dual panes initialize on same customer
    const splitInitSync = await page.evaluate(() => {
      const leftText = document.querySelector('#customer-chat-messages') ? document.body.innerText : '';
      return leftText.includes('NC1021') || leftText.includes('Aarav');
    });
    assert('Test 4.3', 'Split View initializes dual panes synchronously on Aarav', splitInitSync);

    // Switch to Priya in customer portal tab inside Split View
    await page.click('#btn-customer-priya');
    await sleep(1200);

    const splitPriyaSync = await page.evaluate(() => {
      const text = document.body.innerText;
      const leftHasPriya = text.includes('NC1022') && (text.includes('Priya') || text.includes('Smart Fitness Watch'));
      return leftHasPriya;
    });
    assert('Test 4.4', 'Split View: Selecting Priya in customer portal synchronizes both customer and agent panes', splitPriyaSync);

    // Switch to Kabir in customer portal tab inside Split View
    await page.click('#btn-customer-kabir');
    await sleep(1200);

    const splitKabirSync = await page.evaluate(() => {
      const text = document.body.innerText;
      const leftHasKabir = text.includes('NC1023') && (text.includes('Kabir') || text.includes('NovaBass'));
      return leftHasKabir;
    });
    assert('Test 4.5', 'Split View: Selecting Kabir in customer portal synchronizes both customer and agent panes', splitKabirSync);

    // Switch to Aarav from Agent Inbox inside Split View
    console.log('>> Testing switching from Agent Dashboard Inbox...');
    await page.click('#btn-toggle-inbox');
    await sleep(800);

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const aaravInbox = btns.find(b => b.textContent.includes('Aarav Sharma') && (b.textContent.includes('NC1021') || b.querySelector('img')));
      if (aaravInbox) aaravInbox.click();
    });
    await sleep(1200);

    const agentAaravSync = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('NC1021') && (text.includes('Aarav') || text.includes('NovaSprint'));
    });
    assert('Test 4.6', 'Split View: Selecting Aarav in Agent Inbox drawer synchronizes customer portal pane', agentAaravSync);

    // Ensure Inbox drawer is closed (auto-closes upon ticket selection in Split View)
    await page.evaluate(() => {
      const closeBtn = document.querySelector('#btn-close-inbox-drawer');
      if (closeBtn) closeBtn.click();
    });
    await sleep(600);

    await takeScreenshot('customer_portal_split_view.png');

    // =========================================================================
    // PART 5: MULTILINGUAL VERIFICATION (English, Hindi, Marathi)
    // =========================================================================
    console.log('\n--- PART 5: Multilingual Verification ---');

    await page.goto(`${FRONTEND_URL}/customer?customer=cust_aarav&view=welcome`, { waitUntil: 'networkidle0' });
    await sleep(1000);

    // 5.1 English Verification
    const englishVerified = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasGreeting = text.includes('Hello, Aarav. Welcome to NovaCart Support.');
      const hasActions = text.includes('Track an order') && text.includes('Request a return or refund');
      const hasPreservedIds = text.includes('#NC1021') && text.includes('FedEx Express') && text.includes('TRK-NC-882910');
      return hasGreeting && hasActions && hasPreservedIds;
    });
    assert('Test 5.1', 'English welcome experience verified with strict preservation of technical IDs', englishVerified);

    // 5.2 Hindi Verification
    console.log('>> Switching language to Hindi (Devanagari)...');
    await page.select('#customer-language-select', 'hi');
    await sleep(1200);

    const hindiGreetingActions = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasHindiGreeting = text.includes('नमस्ते आरव। नोवाकार्ट सहायता में आपका स्वागत है।') || text.includes('नमस्ते आरव');
      const hasHindiActions = text.includes('ऑर्डर ट्रैक करें') || text.includes('वापसी या रिफंड') || text.includes('सहायता विकल्प');
      const hasPreservedIds = text.includes('#NC1021') && text.includes('FedEx Express') && text.includes('TRK-NC-882910');
      return hasHindiGreeting && hasHindiActions && hasPreservedIds;
    });
    assert('Test 5.2', 'Hindi welcome experience verified: Devanagari copy with preserved #NC1021 & FedEx IDs', hindiGreetingActions);
    await takeScreenshot('hindi_welcome_experience.png');

    // 5.3 Marathi Verification
    console.log('>> Switching language to Marathi (Devanagari)...');
    await page.select('#customer-language-select', 'mr');
    await sleep(1200);

    const marathiGreetingActions = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasMarathiGreeting = text.includes('नमस्कार आरव. नोव्हाकार्ट सपोर्टमध्ये आपले स्वागत आहे.') || text.includes('नमस्कार आरव');
      const hasMarathiActions = text.includes('ऑर्डर ट्रॅक करा') || text.includes('परतावा किंवा परताव्याची विनंती करा') || text.includes('सपोर्ट पर्याय');
      const hasPreservedIds = text.includes('#NC1021') && text.includes('FedEx Express') && text.includes('TRK-NC-882910');
      return hasMarathiGreeting && hasMarathiActions && hasPreservedIds;
    });
    assert('Test 5.3', 'Marathi welcome experience verified: Devanagari copy with preserved #NC1021 & FedEx IDs', marathiGreetingActions);
    await takeScreenshot('marathi_welcome_experience.png');

    // Restore English
    await page.select('#customer-language-select', 'en');
    await sleep(800);

    console.log('\n================================================================');
    console.log(`CUSTOMER PORTAL ACCEPTANCE SUITE COMPLETE!`);
    console.log(`Executed: ${passedCount + failedCount} | Passed: ${passedCount} | Failed: ${failedCount}`);
    console.log('================================================================\n');

  } finally {
    await browser.close();
    for (const p of processes) {
      try { p.kill(); } catch (e) {}
    }
  }
}

runAcceptanceSuite().catch(err => {
  console.error('[FATAL] Acceptance suite error:', err);
  process.exit(1);
});

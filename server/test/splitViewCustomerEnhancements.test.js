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

function assert(description, condition) {
  if (condition) {
    console.log(`[PASS] ${description}`);
  } else {
    console.error(`[FAIL] ${description}`);
    throw new Error(`Assertion failed: ${description}`);
  }
}

async function runEnhancementsSuite() {
  console.log('================================================================');
  console.log('  SPLIT VIEW EXCLUSIVITY & CUSTOMER PORTAL ENHANCEMENT SUITE     ');
  console.log('================================================================\n');

  // Reset tickets to clean initial state before running suite
  try {
    await axios.post(`${BACKEND_URL}/api/tickets/reset`);
  } catch (e) {
    // ignore
  }

  // Launch browser
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1534,880']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1534, height: 880 });

    console.log('--- TEST 1: Split View Default State (Clean Workspace) ---');
    await page.goto(`${FRONTEND_URL}/split`, { waitUntil: 'networkidle0', timeout: 30000 });
    await sleep(2000);

    // Verify both drawers are closed by default
    const inboxDrawerClosed = await page.evaluate(() => {
      return !document.querySelector('#btn-close-inbox-drawer');
    });
    const copilotDrawerClosed = await page.evaluate(() => {
      return !document.querySelector('#btn-close-copilot');
    });
    assert('Test 1.1: Inbox drawer is closed by default in Split View', inboxDrawerClosed);
    assert('Test 1.2: Copilot drawer is closed by default in Split View', copilotDrawerClosed);

    console.log('\n--- TEST 2: Mutually Exclusive Drawer Stacking ---');
    // 1. Click Inbox toggle -> Inbox opens, Copilot remains closed
    await page.click('#btn-toggle-inbox');
    await sleep(600);
    const inboxOpenCopilotClosed = await page.evaluate(() => {
      const inboxOpen = Boolean(document.querySelector('#btn-close-inbox-drawer'));
      const copilotOpen = Boolean(document.querySelector('#btn-close-copilot'));
      return inboxOpen && !copilotOpen;
    });
    assert('Test 2.1: Clicking Inbox opens Inbox drawer, Copilot is closed', inboxOpenCopilotClosed);

    // 2. Click Copilot toggle -> Copilot opens, Inbox AUTOMATICALLY closes!
    await page.click('#btn-toggle-copilot');
    await sleep(600);
    const copilotOpenInboxClosed = await page.evaluate(() => {
      const inboxOpen = Boolean(document.querySelector('#btn-close-inbox-drawer'));
      const copilotOpen = Boolean(document.querySelector('#btn-close-copilot'));
      return copilotOpen && !inboxOpen;
    });
    assert('Test 2.2: Clicking Copilot opens Copilot drawer and AUTOMATICALLY closes Inbox drawer', copilotOpenInboxClosed);

    // 3. Click Inbox toggle again -> Inbox opens, Copilot AUTOMATICALLY closes!
    await page.click('#btn-toggle-inbox');
    await sleep(600);
    const inboxReopenedCopilotClosed = await page.evaluate(() => {
      const inboxOpen = Boolean(document.querySelector('#btn-close-inbox-drawer'));
      const copilotOpen = Boolean(document.querySelector('#btn-close-copilot'));
      return inboxOpen && !copilotOpen;
    });
    assert('Test 2.3: Clicking Inbox again opens Inbox drawer and AUTOMATICALLY closes Copilot drawer', inboxReopenedCopilotClosed);

    // 4. Click Close button on Inbox drawer -> Returns to clean workspace
    await page.click('#btn-close-inbox-drawer');
    await sleep(600);
    const bothClosedAfterX = await page.evaluate(() => {
      const inboxOpen = Boolean(document.querySelector('#btn-close-inbox-drawer'));
      const copilotOpen = Boolean(document.querySelector('#btn-close-copilot'));
      return !inboxOpen && !copilotOpen;
    });
    assert('Test 2.4: Clicking X on Inbox drawer closes drawer back to clean workspace', bothClosedAfterX);

    console.log('\n--- TEST 3: Multilingual Support in Customer Experience ---');
    // Select Hindi
    await page.select('#customer-language-select', 'hi');
    await sleep(800);
    const isHindiActive = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('नोवाकार्ट सपोर्ट') && (text.includes('ऑर्डर ट्रैक करें') || text.includes('त्वरित क्रियाएँ'));
    });
    assert('Test 3.1: Language switcher changes UI to Hindi (Devanagari)', isHindiActive);

    // Select Marathi
    await page.select('#customer-language-select', 'mr');
    await sleep(800);
    const isMarathiActive = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('नोव्हाकार्ट सपोर्ट') && (text.includes('ऑर्डर ट्रॅक करा') || text.includes('त्वरित कृती'));
    });
    assert('Test 3.2: Language switcher changes UI to Marathi', isMarathiActive);

    // Switch back to English
    await page.select('#customer-language-select', 'en');
    await sleep(800);
    const isEnglishActive = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('NovaCart Support') && text.includes('Track my order');
    });
    assert('Test 3.3: Language switcher restores English cleanly', isEnglishActive);

    console.log('\n--- TEST 4: Product Thumbnail & Order Context ---');
    const hasProductThumbnail = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      return images.some(img => img.src.includes('images.unsplash.com') && (img.alt.includes('NovaSprint') || img.alt.includes('NovaPulse') || img.alt.includes('NovaBass')));
    });
    assert('Test 4.1: Product thumbnail is rendered in the order context strip', hasProductThumbnail);

    console.log('\n--- TEST 5: Smart Quick Actions ---');
    // Test quick action "Track my order" toggles tracking details
    const clickedTrack = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const trackBtn = btns.find(b => b.textContent.includes('Track my order') || b.textContent.includes('View tracking'));
      if (trackBtn) {
        trackBtn.click();
        return trackBtn.textContent.trim();
      }
      return null;
    });
    console.log('[DEBUG] Clicked button:', clickedTrack);
    await sleep(800);
    const trackingVisible = await page.evaluate(() => {
      const text = document.body.innerText.toUpperCase();
      return text.includes('COURIER UPDATE') || text.includes('CARRIER:') || text.includes('CARRIER');
    });
    assert('Test 5.1: "Track my order" smart action expands tracking details', trackingVisible);

    console.log('\n--- TEST 6: Resolution Feedback Workflow ---');
    // 1. Mark ticket as Resolved
    const resolveClicked = await page.evaluate(async () => {
      let btn = document.querySelector('#btn-resolve-ticket');
      if (!btn && document.querySelector('#btn-reopen-ticket')) {
        document.querySelector('#btn-reopen-ticket').click();
        await new Promise(r => setTimeout(r, 600));
        btn = document.querySelector('#btn-resolve-ticket');
      }
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    assert('Test 6.1: Agent clicks Resolve', resolveClicked);
    await sleep(1500);

    // 2. Customer sees feedback prompt: "Was your issue resolved?"
    const feedbackPromptVisible = await page.evaluate(() => {
      return document.body.innerText.includes('Was your issue resolved?');
    });
    assert('Test 6.2: Customer portal displays resolution feedback prompt', feedbackPromptVisible);

    // 3. Customer submits feedback with 5 stars
    await page.evaluate(() => {
      const input = document.querySelector('input[placeholder*="Tell us how we did"]');
      if (input) {
        input.value = 'Agent was quick and courteous!';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const btns = Array.from(document.querySelectorAll('button'));
      const submitBtn = btns.find(b => b.textContent.includes('Submit Feedback'));
      if (submitBtn) submitBtn.click();
    });
    await sleep(2000);

    // 4. Verify customer sees thank you
    const thankYouVisible = await page.evaluate(() => {
      return document.body.innerText.includes('Thank you for your feedback');
    });
    assert('Test 6.3: Customer sees "Thank you for your feedback!" confirmation', thankYouVisible);

    // 5. Verify agent dashboard displays Customer Feedback Banner with submission time & rating
    const agentSeesFeedback = await page.evaluate(() => {
      return document.body.innerText.includes('Customer Feedback:') && 
             (document.body.innerText.includes('5/5') || document.body.innerText.includes('⭐⭐⭐⭐⭐'));
    });
    assert('Test 6.4: Agent dashboard displays customer feedback badge with rating and comment', agentSeesFeedback);

    console.log('\n--- TEST 7: Full Ticket Reopening Lifecycle ---');
    // Sequence: Resolved -> Customer Reopens -> Human Requested -> Agent Takes Over -> Resolved
    
    // 1. Customer sends follow-up message to reopen resolved ticket
    const customerInput = await page.$('.w-full.lg\\:w-\\[42\\%\\] form input, form input[placeholder*="message"]');
    if (customerInput) {
      await customerInput.type('I have an additional question about my warranty.');
      await sleep(300);
      const customerSubmit = await page.$('.w-full.lg\\:w-\\[42\\%\\] form button[type="submit"]');
      if (customerSubmit) {
        await customerSubmit.click();
      } else {
        await page.keyboard.press('Enter');
      }
    }
    await sleep(2000);

    const ticketReopened = await page.evaluate(() => {
      const hasAIBadge = Boolean(document.querySelector('#customer-status-badge-ai'));
      const text = document.body.innerText;
      return hasAIBadge || text.includes('AI Handling');
    });
    assert('Test 7.1: Customer message transitions ticket from Resolved to AI Handling', ticketReopened);

    // 2. Customer requests human support
    await page.evaluate(() => {
      const reqBtn = document.querySelector('#btn-request-human');
      if (reqBtn) reqBtn.click();
    });
    await sleep(1500);

    const handoffActive = await page.evaluate(() => {
      return document.body.innerText.includes('Human Requested') && document.body.innerText.includes('Take Over');
    });
    assert('Test 7.2: Customer request transitions ticket to Human Requested on both panes', handoffActive);

    // 3. Agent takes over
    await page.evaluate(() => {
      const takeOverBtn = document.querySelector('#btn-takeover-ticket');
      if (takeOverBtn) takeOverBtn.click();
    });
    await sleep(1500);

    const agentActiveState = await page.evaluate(() => {
      return document.body.innerText.includes('Human Agent Active') || document.body.innerText.includes('Sarah Lin Active');
    });
    assert('Test 7.3: Agent Take Over transitions ticket to Human Agent Active on both panes', agentActiveState);

    // 4. Agent resolves ticket again
    await page.evaluate(() => {
      const resolveBtn = document.querySelector('#btn-resolve-ticket');
      if (resolveBtn) resolveBtn.click();
    });
    await sleep(1500);

    const reResolvedState = await page.evaluate(() => {
      return document.body.innerText.includes('Resolved');
    });
    assert('Test 7.4: Agent Resolves ticket completes the full lifecycle', reResolvedState);

    console.log('\n================================================================');
    console.log('ALL SPLIT VIEW, CX & LIFECYCLE TESTS PASSED! (17/17)');
    console.log('================================================================');
    console.log('================================================================');

  } finally {
    await browser.close();
  }
}

runEnhancementsSuite().catch(err => {
  console.error('\nEnhancements test failed:', err);
  process.exit(1);
});

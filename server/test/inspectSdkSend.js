import puppeteer from 'puppeteer-core';
import axios from 'axios';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FRONTEND_URL = 'http://127.0.0.1:5173';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function inspectSend() {
  console.log('--- INSPECTING SDK SEND ---');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const ctxAgent = await browser.createBrowserContext();
  const ctxAarav = await browser.createBrowserContext();

  const pageAgent = await ctxAgent.newPage();
  const pageAarav = await ctxAarav.newPage();

  pageAgent.on('console', msg => console.log('[AGENT]:', msg.text()));
  pageAgent.on('pageerror', err => console.error('[AGENT ERR]:', err.message));

  pageAarav.on('console', msg => console.log('[AARAV]:', msg.text()));
  pageAarav.on('pageerror', err => console.error('[AARAV ERR]:', err.message));

  console.log('Loading Agent...');
  await pageAgent.goto(`${FRONTEND_URL}/agent`, { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  console.log('Loading Aarav...');
  await pageAarav.goto(`${FRONTEND_URL}/customer`, { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  console.log('\n--- Typing and sending message from Aarav ---');
  await pageAarav.type('input[placeholder*="Type your message"]', 'Hello from Aarav Inspection Test');
  await sleep(500);
  await pageAarav.click('button[type="submit"]');

  console.log('Waiting 5s for network delivery...');
  await sleep(5000);

  console.log('\n--- Checking Aarav DOM ---');
  const aaravText = await pageAarav.evaluate(() => document.body.innerText);
  console.log('Aarav has message?', aaravText.includes('Hello from Aarav Inspection Test'));

  console.log('\n--- Checking Agent DOM ---');
  const agentText = await pageAgent.evaluate(() => document.body.innerText);
  console.log('Agent has message?', agentText.includes('Hello from Aarav Inspection Test'));

  await browser.close();
}

inspectSend().catch(console.error);

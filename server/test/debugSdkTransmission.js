import puppeteer from 'puppeteer-core';
import axios from 'axios';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BACKEND_URL = 'http://127.0.0.1:5000';
const FRONTEND_URL = 'http://127.0.0.1:5173';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function debugDirectTransmission() {
  console.log('--- DEBUG DIRECT TRANSMISSION ---');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const ctxAgent = await browser.createBrowserContext();
  const ctxAarav = await browser.createBrowserContext();

  const pageAgent = await ctxAgent.newPage();
  const pageAarav = await ctxAarav.newPage();

  pageAgent.on('console', msg => console.log('[Agent Log]:', msg.text()));
  pageAgent.on('pageerror', err => console.error('[Agent PageError]:', err.message));

  pageAarav.on('console', msg => console.log('[Aarav Log]:', msg.text()));
  pageAarav.on('pageerror', err => console.error('[Aarav PageError]:', err.message));

  console.log('Loading Agent page...');
  await pageAgent.goto(`${FRONTEND_URL}/agent`, { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  console.log('Loading Aarav page...');
  await pageAarav.goto(`${FRONTEND_URL}/customer`, { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  console.log('Sending message from Aarav to Agent via page evaluate...');
  const sendRes = await pageAarav.evaluate(async () => {
    try {
      // Find input and send button
      const input = document.querySelector('input[placeholder*="Type your message"]');
      input.value = 'Hello Sarah from Aarav Debug';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      const form = document.querySelector('form');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return { submitted: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  console.log('Send evaluation result:', sendRes);
  await sleep(4000);

  const agentDom = await pageAgent.evaluate(() => document.body.innerText);
  console.log('Agent sees "Hello Sarah from Aarav Debug"?', agentDom.includes('Hello Sarah from Aarav Debug'));

  await browser.close();
}

debugDirectTransmission().catch(console.error);

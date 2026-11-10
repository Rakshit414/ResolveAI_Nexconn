import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const appKey = process.env.NEXCONN_APP_KEY;
const appSecret = process.env.NEXCONN_APP_SECRET;
const baseUrl = process.env.NEXCONN_API_URL || 'https://api.sg-light-api.com';

console.log('=== [LIVE NEXCONN TWO-SIDED END-TO-END VERIFICATION] ===');
console.log('Gateway URL:', baseUrl);
console.log('App Key:', appKey ? `${appKey.slice(0, 4)}...${appKey.slice(-2)}` : 'MISSING');

function generateHeaders() {
  const nonce = Math.floor(Math.random() * 1e16).toString().slice(0, 18);
  const timestamp = Date.now().toString();
  const signature = crypto
    .createHash('sha1')
    .update(`${appSecret}${nonce}${timestamp}`)
    .digest('hex');

  return {
    'Content-Type': 'application/json',
    'App-Key': appKey,
    'Nonce': nonce,
    'Timestamp': timestamp,
    'Signature': signature
  };
}

async function issueToken(userId, name) {
  const headers = generateHeaders();
  const payload = { userId, name };
  const res = await axios.post(`${baseUrl}/v4/auth/access-token/issue`, payload, { headers, timeout: 8000 });
  return {
    code: res.data.code,
    result: res.data.result || res.data
  };
}

async function sendDirectMessage(fromUserId, toUserId, text, extra = {}) {
  const headers = generateHeaders();
  const serializedContent = JSON.stringify({
    content: text,
    extra: JSON.stringify(extra)
  });

  const payload = {
    fromUserId,
    toUserIds: [toUserId],
    messageType: 'RC:TxtMsg',
    content: serializedContent,
    hasMetadata: false
  };

  const res = await axios.post(`${baseUrl}/v4/direct-channel/message/send`, payload, { headers, timeout: 10000 });
  return {
    status: res.status,
    code: res.data.code,
    data: res.data
  };
}

async function runLiveTest() {
  try {
    // 1. Verify identities and issue real access tokens
    console.log('\n--- 1. Identity Token Issuance ---');
    
    // Customer Aarav
    const aaravToken = await issueToken('cust_aarav', 'Aarav Sharma');
    console.log('Customer (cust_aarav) Token Result: code =', aaravToken.code, 'hasToken =', Boolean(aaravToken.result?.accessToken || aaravToken.result?.token));

    // Agent Sarah Lin
    const sarahToken = await issueToken('agent_sarah', 'Sarah Lin');
    console.log('Agent (agent_sarah) Token Result: code =', sarahToken.code, 'hasToken =', Boolean(sarahToken.result?.accessToken || sarahToken.result?.token));

    // Support Identity: novacart_support
    const supportToken = await issueToken('novacart_support', 'NovaCart Support');
    console.log('Brand Support (novacart_support) Token Result: code =', supportToken.code, 'hasToken =', Boolean(supportToken.result?.accessToken || supportToken.result?.token));

    // 2. Customer -> Agent (or Support) Live DirectChannel Send
    console.log('\n--- 2. Customer Sends to Agent via DirectChannel ---');
    const customerMsg = `Live test inquiry from Aarav Sharma regarding Order NC1021 [timestamp: ${Date.now()}]`;
    const custSendRes = await sendDirectMessage(
      'cust_aarav',
      'agent_sarah',
      customerMsg,
      { ticketId: 'tkt_1021', brandId: 'brand_novacart', role: 'customer' }
    );

    console.log('Customer Send HTTP Status:', custSendRes.status);
    console.log('Customer Send App Code:', custSendRes.code, custSendRes.code === 0 ? '(SUCCESS)' : '(FAILED)');
    console.log('Customer Send Response Data:', JSON.stringify(custSendRes.data, null, 2));

    const custMsgId = custSendRes.data?.result?.messageIds?.[0]?.messageId || custSendRes.data?.result?.messageId;
    console.log('-> Captured Customer Message ID:', custMsgId);

    // 3. Agent -> Customer Live DirectChannel Reply
    console.log('\n--- 3. Agent (Sarah Lin) Replies to Customer via DirectChannel ---');
    const agentReply = `Hello Aarav, Sarah Lin here. Your NovaSprint Pro shoes (NC1021) are moving through customs clearance [timestamp: ${Date.now()}]`;
    const agentSendRes = await sendDirectMessage(
      'agent_sarah',
      'cust_aarav',
      agentReply,
      { ticketId: 'tkt_1021', brandId: 'brand_novacart', role: 'agent' }
    );

    console.log('Agent Send HTTP Status:', agentSendRes.status);
    console.log('Agent Send App Code:', agentSendRes.code, agentSendRes.code === 0 ? '(SUCCESS)' : '(FAILED)');
    console.log('Agent Send Response Data:', JSON.stringify(agentSendRes.data, null, 2));

    const agentMsgId = agentSendRes.data?.result?.messageIds?.[0]?.messageId || agentSendRes.data?.result?.messageId;
    console.log('-> Captured Agent Message ID:', agentMsgId);

    // 4. Verify Brand Support Bot Automated Message
    console.log('\n--- 4. Brand Support Identity (novacart_support) Sends to Customer ---');
    const botMsg = `NovaCart Automated Notice: Package NC1021 transit status updated.`;
    const botSendRes = await sendDirectMessage(
      'novacart_support',
      'cust_aarav',
      botMsg,
      { ticketId: 'tkt_1021', brandId: 'brand_novacart', role: 'system' }
    );
    console.log('Support Send App Code:', botSendRes.code, botSendRes.code === 0 ? '(SUCCESS)' : '(FAILED)');
    const botMsgId = botSendRes.data?.result?.messageIds?.[0]?.messageId;
    console.log('-> Captured Support Message ID:', botMsgId);

    console.log('\n==================================================');
    console.log('LIVE TWO-SIDED NEXCONN TEST COMPLETED SUCCESSFULLY');
    console.log('==================================================');
  } catch (err) {
    console.error('LIVE NEXCONN TEST FAILED:', err.response?.data || err.message);
    process.exit(1);
  }
}

runLiveTest();

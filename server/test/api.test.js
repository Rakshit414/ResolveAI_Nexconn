// Automated verification suite for Resolve AI Backend Services
import axios from 'axios';

const BASE_URL = 'http://localhost:5000';

async function runTests() {
  console.log('--- Starting Resolve AI Backend Verification ---');
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      if (err.response) {
        console.error('Response data:', err.response.data);
      }
      failed++;
    }
  }

  // 1. Health check
  await test('GET /api/health returns status ok', async () => {
    const res = await axios.get(`${BASE_URL}/api/health`);
    if (res.data?.status !== 'ok') throw new Error('Health status is not ok');
  });

  // 2. Knowledge base
  await test('GET /api/knowledge returns NovaCart policies', async () => {
    const res = await axios.get(`${BASE_URL}/api/knowledge`);
    if (!res.data?.data?.policies || res.data.data.policies.length < 5) {
      throw new Error('Policies missing or incomplete');
    }
  });

  // 3. Ticket listing
  await test('GET /api/tickets returns seeded customer tickets', async () => {
    const res = await axios.get(`${BASE_URL}/api/tickets`);
    if (!res.data?.tickets || res.data.tickets.length < 3) {
      throw new Error('Tickets array missing or less than 3');
    }
  });

  // 4. Ticket filtering
  await test('GET /api/tickets?priority=High filters correctly', async () => {
    const res = await axios.get(`${BASE_URL}/api/tickets?priority=High`);
    if (!res.data?.tickets?.every(t => t.priority.toLowerCase() === 'high')) {
      throw new Error('Filter priority failed');
    }
  });

  // 5. Human handoff
  await test('POST /api/tickets/tkt_1022/human-handoff updates status', async () => {
    const res = await axios.post(`${BASE_URL}/api/tickets/tkt_1022/human-handoff`);
    if (res.data?.ticket?.status !== 'Human Requested' && res.data?.ticket?.status !== 'Human Assistance Requested') {
      throw new Error('Human assistance requested status not set');
    }
  });

  // 6. AI Analyze
  await test('POST /api/ai/analyze returns category, priority, and sentiment', async () => {
    const res = await axios.post(`${BASE_URL}/api/ai/analyze`, {
      messages: [{ sender: 'Aarav Sharma', text: 'Where is my order? It is delayed by 3 days.' }],
      customer: { name: 'Aarav Sharma' },
      order: { orderId: 'NC1021', product: 'Running Shoes' }
    });
    const d = res.data?.data;
    if (!d?.category || !d?.priority || !d?.sentiment) {
      throw new Error('Missing classification fields');
    }
  });

  // 7. AI Summarize
  await test('POST /api/ai/summarize returns structured summary', async () => {
    const res = await axios.post(`${BASE_URL}/api/ai/summarize`, {
      messages: [{ sender: 'Priya Mehta', text: 'I received the smartwatch but need a return.' }],
      customer: { name: 'Priya Mehta' },
      order: { orderId: 'NC1022', product: 'Smartwatch' }
    });
    const d = res.data?.data;
    if (!d?.whatHappened || !d?.customerNeeds || !d?.pendingAction) {
      throw new Error('Missing summary fields');
    }
  });

  // 8. AI Suggest Reply
  await test('POST /api/ai/suggest-reply returns policy-compliant suggestion', async () => {
    const res = await axios.post(`${BASE_URL}/api/ai/suggest-reply`, {
      messages: [{ sender: 'Kabir Verma', text: 'You sent the wrong product.' }],
      customer: { name: 'Kabir Verma' },
      order: { orderId: 'NC1023', product: 'Wireless Headphones' }
    });
    const d = res.data?.data;
    if (!d?.suggestedReply || !d?.policyReferences) {
      throw new Error('Missing suggested reply or policies');
    }
  });

  // 9. Nexconn Token
  await test('POST /api/nexconn/token handles token issuance', async () => {
    const res = await axios.post(`${BASE_URL}/api/nexconn/token`, {
      userId: 'cust_aarav',
      name: 'Aarav Sharma'
    });
    if (!res.data?.success || !res.data?.token) {
      throw new Error('Token generation failed');
    }
  });

  console.log(`\nVerification Complete: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests();

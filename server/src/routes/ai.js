import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { BUSINESS_INFO } from '../data/demoData.js';

const router = express.Router();

// Helper to get Gemini model if key is provided
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey.includes('your_')) {
    return null;
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  return genAI.getGenerativeModel({ model: modelName });
}

/**
 * POST /api/ai/analyze
 * Analyzes conversation or latest message to classify:
 * - Issue category
 * - Priority
 * - Sentiment
 * - Short issue description
 */
router.post('/analyze', async (req, res) => {
  const { messages, customer, order } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ success: false, error: 'messages array is required' });
  }

  const model = getGeminiClient();

  const conversationText = messages
    .map(m => `${m.sender || m.senderName || 'User'}: ${m.text || m.content}`)
    .join('\n');

  const orderContext = order ? JSON.stringify(order, null, 2) : 'No order info provided';
  const customerContext = customer ? `${customer.name} (${customer.email})` : 'Unknown customer';

  const systemPrompt = `You are Resolve AI's issue classifier for customer support platform NovaCart.
Analyze the following customer support conversation and order details.

Valid Categories:
- Delivery Delay
- Refund Request
- Cancellation
- Wrong Product
- Damaged Product
- Payment Issue
- General Inquiry
- Other

Valid Priorities:
- Critical (e.g. damaged goods, wrong goods delivered, severe customer anger)
- High (e.g. delivery delay past promised date, payment failures)
- Medium (e.g. standard return inquiry within policy window, general tracking request)
- Low (e.g. general product questions, positive feedback)

Valid Sentiments:
- Positive
- Neutral
- Frustrated
- Negative

Return ONLY a valid JSON object matching this schema without markdown fences:
{
  "category": "one of the valid categories",
  "priority": "Critical" | "High" | "Medium" | "Low",
  "sentiment": "Positive" | "Neutral" | "Frustrated" | "Negative",
  "issueDescription": "A concise 1-2 sentence description of the core issue",
  "confidenceScore": 0.95
}`;

  if (model) {
    try {
      const prompt = `${systemPrompt}\n\nCustomer: ${customerContext}\nOrder Details:\n${orderContext}\n\nConversation History:\n${conversationText}\n\nJSON Output:`;
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      return res.json({
        success: true,
        source: 'gemini',
        data: parsed,
      });
    } catch (err) {
      console.error('Gemini Classification Error:', err.message);
      // Fallback with realistic analysis if Gemini call failed
    }
  }

  // Fallback heuristic classification when API key is not yet set
  let category = 'General Inquiry';
  let priority = 'Medium';
  let sentiment = 'Neutral';
  let issueDescription = 'Customer inquiry requiring review.';

  const fullText = (conversationText + ' ' + (order?.reportedIssue || '')).toLowerCase();

  if (fullText.includes('wrong') || fullText.includes('incorrect') || fullText.includes('annoyed')) {
    category = 'Wrong Product';
    priority = 'Critical';
    sentiment = 'Negative';
    issueDescription = 'Customer received an incorrect item instead of what was ordered.';
  } else if (fullText.includes('delay') || fullText.includes('where is') || fullText.includes('tracking hasn\'t moved') || fullText.includes('late')) {
    category = 'Delivery Delay';
    priority = 'High';
    sentiment = 'Frustrated';
    issueDescription = 'Shipment is delayed past estimated delivery date.';
  } else if (fullText.includes('refund') || fullText.includes('return') || fullText.includes('bulky')) {
    category = 'Refund Request';
    priority = 'Medium';
    sentiment = 'Neutral';
    issueDescription = 'Customer requested a return and refund for an eligible delivered item.';
  } else if (fullText.includes('cancel')) {
    category = 'Cancellation';
    priority = 'Medium';
    sentiment = 'Neutral';
    issueDescription = 'Order cancellation inquiry.';
  }

  return res.json({
    success: true,
    source: 'fallback',
    configured: Boolean(model),
    data: {
      category,
      priority,
      sentiment,
      issueDescription,
      confidenceScore: 0.88,
    },
  });
});

/**
 * POST /api/ai/summarize
 * Generates structured 4-part summary:
 * - What happened
 * - What the customer needs
 * - What has already been discussed
 * - What action is still pending
 */
router.post('/summarize', async (req, res) => {
  const { messages, customer, order } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ success: false, error: 'messages array is required' });
  }

  const model = getGeminiClient();
  const conversationText = messages
    .map(m => `${m.sender || m.senderName || 'User'}: ${m.text || m.content}`)
    .join('\n');

  const orderContext = order ? JSON.stringify(order, null, 2) : 'No order info';

  const systemPrompt = `You are Resolve AI's summarization engine.
Generate a concise summary of the conversation in valid JSON without markdown fences:
{
  "whatHappened": "Clear description of events and problem",
  "customerNeeds": "Specific outcome or resolution requested by customer",
  "discussedSoFar": "What information or replies have already been exchanged",
  "pendingAction": "What the support agent or business must do next"
}`;

  if (model) {
    try {
      const prompt = `${systemPrompt}\n\nCustomer: ${customer?.name || 'Customer'}\nOrder: ${orderContext}\n\nConversation:\n${conversationText}\n\nJSON Output:`;
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      return res.json({
        success: true,
        source: 'gemini',
        data: parsed,
      });
    } catch (err) {
      console.error('Gemini Summarize Error:', err.message);
    }
  }

  // Fallback structured summary
  const latestMsg = messages[messages.length - 1]?.text || 'No message';
  return res.json({
    success: true,
    source: 'fallback',
    configured: Boolean(model),
    data: {
      whatHappened: order?.reportedIssue || `Customer reached out regarding order ${order?.orderId || 'inquiry'}.`,
      customerNeeds: order?.orderId ? `Resolution for order ${order.orderId} (${order.product}).` : 'Support clarification.',
      discussedSoFar: `Customer sent initial message: "${latestMsg.substring(0, 80)}..."`,
      pendingAction: 'Human agent needs to inspect logistics status and approve recommended response.',
    },
  });
});

/**
 * POST /api/ai/suggest-reply
 * Generates context-aware, policy-compliant reply for agent approval.
 * Adheres strictly to NovaCart business policies.
 */
router.post('/suggest-reply', async (req, res) => {
  const { messages, customer, order } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ success: false, error: 'messages array is required' });
  }

  const model = getGeminiClient();
  const conversationText = messages
    .map(m => `${m.sender || m.senderName || 'User'}: ${m.text || m.content}`)
    .join('\n');

  const policiesText = BUSINESS_INFO.policies
    .map(p => `- ${p.topic}: ${p.rule} (Guideline: ${p.actionGuideline})`)
    .join('\n');

  const systemPrompt = `You are Resolve AI's Copilot for support agents at NovaCart.
Your task is to draft a polite, professional, and policy-compliant suggested response for the human agent to review and approve.

CRITICAL RULES:
1. Adhere strictly to the NovaCart Business Policies below.
2. NEVER invent order details, tracking states, or package locations not found in the order context.
3. NEVER make unsupported refund or compensation guarantees.
4. Standard delivery is 4-6 business days.
5. Refund window is 7 days from delivery.
6. Damaged or wrong products REQUIRE supporting photographs before final replacement/refund.
7. If critical information is missing, ask a clear, polite clarification.

NovaCart Policies:
${policiesText}

Return valid JSON without markdown fences:
{
  "suggestedReply": "The complete drafted reply for the customer",
  "policyReferences": ["List of policy topics referenced"],
  "requiresClarification": boolean,
  "confidenceScore": 0.94
}`;

  if (model) {
    try {
      const prompt = `${systemPrompt}\n\nCustomer: ${customer?.name || 'Customer'} (${customer?.email || 'N/A'})\nOrder Context:\n${JSON.stringify(order, null, 2)}\n\nConversation History:\n${conversationText}\n\nJSON Output:`;
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      return res.json({
        success: true,
        source: 'gemini',
        data: parsed,
      });
    } catch (err) {
      console.error('Gemini Suggest Reply Error:', err.message);
    }
  }

  // Fallback response based on order context
  let reply = "Hello! Thank you for contacting NovaCart Support. I am reviewing your order details now and will assist you shortly.";
  let policies = ["Standard Support"];

  if (order?.orderId === 'NC1021') {
    reply = `Hello Aarav, I sincerely apologize for the delay with your NovaSprint Pro shoes (Order #NC1021). I checked our courier dispatch system: your package is currently at the regional distribution center undergoing a transit check. Standard delivery takes 4–6 business days, and while your order encountered unexpected hub congestion, I have flagged it for priority movement. I will monitor this shipment and update you within 24 hours.`;
    policies = ["Delivery Timeframe", "Commitments & Guarantees"];
  } else if (order?.orderId === 'NC1022') {
    reply = `Hi Priya, thank you for reaching out! You are well within NovaCart's 7-day return window since your smartwatch was delivered on November 6th. According to our return policy, refunds are processed once the item is inspected at our returns hub in its original packaging. I can generate a pre-paid return shipping label for you right away. Would you like me to send that to priya.mehta@example.com?`;
    policies = ["Refund Window", "Refund Verification"];
  } else if (order?.orderId === 'NC1023') {
    reply = `Hi Kabir, I am so sorry for this mix-up with order #NC1023. You should have received the NovaBass Wireless ANC Headphones, and receiving the wrong item is unacceptable. Under our incorrect product policy, we will expedite the correct wireless headphones to you at zero additional cost. To trigger the immediate replacement order and complimentary return label, could you please share a quick photo of the item and box barcode you received?`;
    policies = ["Damaged or Wrong Products", "Commitments & Guarantees"];
  }

  return res.json({
    success: true,
    source: 'fallback',
    configured: Boolean(model),
    data: {
      suggestedReply: reply,
      policyReferences: policies,
      requiresClarification: false,
      confidenceScore: 0.91,
    },
  });
});

export default router;

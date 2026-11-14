import axios from 'axios';
import crypto from 'crypto';

/**
 * Official Server-Side Nexconn Direct Channel Messaging API Client
 * Strictly uses signed HTTP REST requests against POST /v4/direct-channel/message/send.
 */
export async function sendDirectChannelMessage({
  fromUserId,
  toUserId,
  messageType = 'RC:TxtMsg',
  content,
  correlationData = null, // { ticketId, outboxId, brandId }
  topLevelMetadata = null // Optional top-level metadata expansion
}) {
  const appKey = process.env.NEXCONN_APP_KEY;
  const appSecret = process.env.NEXCONN_APP_SECRET;
  const baseUrl = process.env.NEXCONN_API_URL || 'https://api.sg-light-api.com';

  if (!appKey || !appSecret) {
    throw new Error('NEXCONN_APP_KEY and NEXCONN_APP_SECRET are required for server-side dispatch');
  }

  // 1. Nonce length strictly <= 18 characters
  const nonce = Math.floor(Math.random() * 1e16).toString().slice(0, 18);

  // 2. Timestamp strictly Unix milliseconds
  const timestamp = Date.now().toString();

  // 3. Signature: SHA1(AppSecret + Nonce + Timestamp)
  const signature = crypto
    .createHash('sha1')
    .update(`${appSecret}${nonce}${timestamp}`)
    .digest('hex');

  // 4. Immutable correlation identifiers placed inside content.extra
  let serializedContent;
  if (typeof content === 'string') {
    serializedContent = JSON.stringify({
      content,
      extra: correlationData ? JSON.stringify(correlationData) : undefined
    });
  } else {
    serializedContent = JSON.stringify({
      ...content,
      extra: correlationData ? JSON.stringify(correlationData) : content.extra
    });
  }

  // 5. Official request body: only set hasMetadata = true if topLevelMetadata is provided
  const payload = {
    fromUserId,
    toUserIds: [toUserId],
    messageType,
    content: serializedContent,
    hasMetadata: Boolean(topLevelMetadata),
    ...(topLevelMetadata ? { metadata: topLevelMetadata } : {})
  };

  try {
    const response = await axios.post(`${baseUrl}/v4/direct-channel/message/send`, payload, {
      headers: {
        'Content-Type': 'application/json',
        'App-Key': appKey,
        'Nonce': nonce,
        'Timestamp': timestamp,
        'Signature': signature
      },
      timeout: parseInt(process.env.NEXCONN_TIMEOUT_MS, 10) || 10000
    });

    // 6. Application-level success check: STRICTLY code === 0
    if (response.data?.code !== 0) {
      throw new Error(`Nexconn API Error: code ${response.data?.code} - ${response.data?.msg || 'Non-zero return code'}`);
    }

    // 7. Parse result.messageIds corresponding to the expected recipient
    const recipientEntry = response.data?.result?.messageIds?.find(item => item.userId === toUserId);
    const messageId = recipientEntry?.messageId || response.data?.result?.messageId || response.data?.msgUID;

    if (!messageId) {
      throw new Error(`Nexconn response missing messageId for target recipient ${toUserId}`);
    }

    return {
      success: true,
      code: response.data.code,
      messageId,
      rawResult: response.data.result
    };
  } catch (err) {
    const isTimeout = err.code === 'ECONNABORTED' || err.message?.includes('timeout') || err.message?.includes('ETIMEDOUT');
    return {
      success: false,
      isNetworkTimeout: isTimeout,
      error: err.response?.data || err.message
    };
  }
}

export default {
  sendDirectChannelMessage
};

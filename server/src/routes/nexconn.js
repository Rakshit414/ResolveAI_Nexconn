import express from 'express';
import axios from 'axios';
import crypto from 'crypto';

const router = express.Router();

/**
 * POST /api/nexconn/token
 * Issues a Nexconn user token for Web Chat SDK connection.
 * If NEXCONN_APP_KEY and NEXCONN_APP_SECRET are present, calls Nexconn v4 auth endpoint.
 * Otherwise returns clear configuration guidance.
 */
router.post('/token', async (req, res) => {
  const { userId, name, avatar } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId is required' });
  }

  const appKey = process.env.NEXCONN_APP_KEY;
  const appSecret = process.env.NEXCONN_APP_SECRET;

  if (!appKey || !appSecret) {
    // Return explicit configuration required response
    return res.json({
      success: true,
      configured: false,
      appKey: appKey || null,
      token: `demo_token_${userId}_${Date.now()}`,
      userId,
      name: name || userId,
      message: 'Nexconn credentials not fully configured in .env. To enable live messaging network, provide NEXCONN_APP_KEY and NEXCONN_APP_SECRET in server environment.',
    });
  }

  try {
    // Generate signature headers for Nexconn v4 API
    // Headers typically include: App-Key, Nonce, Timestamp, Signature
    const nonce = Math.floor(Math.random() * 1000000).toString();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    
    // Signature = SHA1(AppSecret + Nonce + Timestamp)
    const signature = crypto
      .createHash('sha1')
      .update(`${appSecret}${nonce}${timestamp}`)
      .digest('hex');

    const response = await axios.post(
      'https://api.nexconn.ai/v4/auth/access-token/issue',
      {
        userId,
        name: name || userId,
        portraitUri: avatar || '',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'App-Key': appKey,
          'Nonce': nonce,
          'Timestamp': timestamp,
          'Signature': signature,
        },
        timeout: 8000,
      }
    );

    return res.json({
      success: true,
      configured: true,
      appKey,
      token: response.data?.token || response.data?.data?.token,
      userId,
      name,
    });
  } catch (err) {
    console.error('Nexconn Token Issue Error:', err.response?.data || err.message);
    return res.status(502).json({
      success: false,
      configured: true,
      error: 'Failed to issue token from Nexconn API',
      details: err.response?.data || err.message,
    });
  }
});

/**
 * GET /api/nexconn/status
 * Returns current configuration status of Nexconn SDK
 */
router.get('/status', (req, res) => {
  const appKey = process.env.NEXCONN_APP_KEY;
  const appSecret = process.env.NEXCONN_APP_SECRET;

  res.json({
    success: true,
    hasAppKey: Boolean(appKey && appKey.trim() !== '' && !appKey.includes('your_')),
    hasAppSecret: Boolean(appSecret && appSecret.trim() !== '' && !appSecret.includes('your_')),
    appKeyPrefix: appKey ? `${appKey.substring(0, 4)}...` : null,
  });
});

export default router;

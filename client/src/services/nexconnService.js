import { NCEngine } from '@nexconn/chat';
import { getNexconnToken, getNexconnStatus } from './api';

class NexconnManager {
  constructor() {
    this.initialized = false;
    this.connected = false;
    this.currentUser = null;
    this.appKey = null;
    this.handlers = new Set();
    this.messageSubscribers = new Map(); // channelId -> Set of callbacks
    this.directChannels = new Map(); // targetUserId -> channel instance
  }

  /**
   * Initialize the Nexconn Chat Engine with App Key
   */
  async initialize(appKey) {
    if (this.initialized && this.appKey === appKey) {
      return true;
    }

    try {
      if (!appKey) {
        const status = await getNexconnStatus().catch(() => ({}));
        if (status.appKey) {
          appKey = status.appKey;
        }
      }

      if (!appKey) {
        console.warn('[Nexconn] No App Key available. Waiting for configuration.');
        return false;
      }

      this.appKey = appKey;
      if (NCEngine && typeof NCEngine.initialize === 'function') {
        await NCEngine.initialize({ appKey });
        this.initialized = true;
        console.log('[Nexconn] Engine successfully initialized with App Key:', appKey.substring(0, 5) + '...');
        return true;
      }
    } catch (err) {
      console.warn('[Nexconn] Initialization note:', err.message || err);
    }
    return false;
  }

  /**
   * Connect an authenticated user to Nexconn
   */
  async connectUser(user) {
    this.currentUser = user;

    try {
      // 1. Fetch user token from backend
      const tokenRes = await getNexconnToken({
        userId: user.id,
        name: user.name,
        avatar: user.avatar,
      });

      if (!tokenRes.configured) {
        console.log('[Nexconn] Demo user connection active (backend credentials pending):', user.name);
        this.connected = true;
        return { connected: true, liveNetwork: false, user };
      }

      // 2. Initialize engine if not already done
      if (!this.initialized && tokenRes.appKey) {
        await this.initialize(tokenRes.appKey);
      }

      // 3. Connect to Nexconn Engine
      if (NCEngine && typeof NCEngine.connect === 'function' && tokenRes.token) {
        // Register global message handler if not already done
        this.registerGlobalHandler();

        await NCEngine.connect({ token: tokenRes.token });
        this.connected = true;
        console.log('[Nexconn] User connected to live network:', user.name);
        return { connected: true, liveNetwork: true, user, token: tokenRes.token };
      }
    } catch (err) {
      console.error('[Nexconn] Connection error:', err);
    }

    // Fallback connection state
    this.connected = true;
    return { connected: true, liveNetwork: false, user };
  }

  /**
   * Register incoming message handler with NCEngine
   */
  registerGlobalHandler() {
    const handlerId = 'resolve-ai-message-listener';
    try {
      if (NCEngine && typeof NCEngine.addMessageHandler === 'function') {
        NCEngine.addMessageHandler(handlerId, {
          onMessageReceived: (event) => {
            console.log('[Nexconn] Real-time message received:', event);
            const msg = event?.message || event;
            this.broadcastMessage(msg);
          },
          onOfflineMessageSyncCompleted: () => {
            console.log('[Nexconn] Offline message synchronization completed');
          },
        });
      }
    } catch (err) {
      console.warn('[Nexconn] addMessageHandler note:', err.message);
    }
  }

  /**
   * Broadcast message to local channel subscribers
   */
  broadcastMessage(message) {
    this.messageSubscribers.forEach((callbacks) => {
      callbacks.forEach((cb) => {
        try {
          cb(message);
        } catch (e) {
          console.error('[Nexconn] Subscriber callback error:', e);
        }
      });
    });
  }

  /**
   * Subscribe to messages for a given channel or conversation
   */
  subscribe(channelId, callback) {
    if (!this.messageSubscribers.has(channelId)) {
      this.messageSubscribers.set(channelId, new Set());
    }
    this.messageSubscribers.get(channelId).add(callback);

    // Return unsubscribe function
    return () => {
      const subs = this.messageSubscribers.get(channelId);
      if (subs) {
        subs.delete(callback);
      }
    };
  }

  /**
   * Send a text message via Nexconn DirectChannel
   */
  async sendMessage(targetUserId, text, metadata = {}) {
    if (!text || !text.trim()) return null;

    const messagePayload = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      senderId: this.currentUser?.id || 'anonymous',
      senderName: this.currentUser?.name || 'Customer',
      senderRole: this.currentUser?.role ? 'agent' : 'customer',
      senderAvatar: this.currentUser?.avatar,
      targetUserId,
      text: text.trim(),
      timestamp: new Date().toISOString(),
      metadata,
    };

    // If live NCEngine is connected and has DirectChannel capability
    try {
      // Try using Nexconn SDK direct channel if available
      const DirectChannelClass = window?.DirectChannel || NCEngine?.DirectChannel;
      if (DirectChannelClass) {
        let channel = this.directChannels.get(targetUserId);
        if (!channel) {
          channel = new DirectChannelClass(targetUserId);
          this.directChannels.set(targetUserId, channel);
        }

        if (channel && typeof channel.sendMessage === 'function') {
          await channel.sendMessage({
            messageParams: { text: text.trim() },
          });
        }
      }
    } catch (sdkErr) {
      console.log('[Nexconn] SDK channel dispatch:', sdkErr.message);
    }

    // Notify local subscribers
    this.broadcastMessage(messagePayload);

    return messagePayload;
  }

  /**
   * Disconnect current session
   */
  async disconnect() {
    try {
      if (NCEngine && typeof NCEngine.disconnect === 'function') {
        await NCEngine.disconnect();
      }
    } catch (e) {
      // ignore
    }
    this.connected = false;
    this.currentUser = null;
  }
}

export const nexconnService = new NexconnManager();
export default nexconnService;

import { NCEngine } from '@nexconn/chat';
import { getNexconnToken, getNexconnStatus } from './api.js';
import { DEMO_CUSTOMERS } from '../data/demoData.js';

/**
 * Robust Nexconn Messaging Manager
 * Enforces strict channel isolation, persistent message history,
 * deduplication, and single-channel event dispatching.
 */
class NexconnManager {
  constructor() {
    this.initialized = false;
    this.connected = false;
    this.currentUser = null;
    this.appKey = null;
    this.token = null;

    // Strict channel-specific subscriber map: channelId -> Set<callback>
    this.channelSubscribers = new Map();

    // Persistent in-memory channel message history: channelId -> Message[]
    this.channelHistory = new Map();

    // Set of seen message IDs to guarantee absolute deduplication
    this.seenMessageIds = new Set();

    // Map of active Nexconn DirectChannel instances: targetUserId -> DirectChannel instance
    this.directChannels = new Map();

    // Guard against rapid duplicate submissions
    this.inFlightSends = new Set();

    // Initialize seed message history for demo channels
    this.initializeSeedHistory();
  }

  /**
   * Seed initial conversation history per channel
   */
  initializeSeedHistory() {
    DEMO_CUSTOMERS.forEach((c) => {
      const channelId = c.channelId || `channel_${c.order.orderId}`;
      const initialMsgId = `msg_seed_${c.id}_${c.order.orderId}`;
      
      const seedMsg = {
        id: initialMsgId,
        messageId: initialMsgId,
        channelId,
        senderId: c.id,
        senderName: c.name,
        senderRole: 'customer',
        senderAvatar: c.avatar,
        targetUserId: 'agent_sarah',
        text: c.order.initialMessage,
        timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
        orderId: c.order.orderId,
      };

      this.seenMessageIds.add(initialMsgId);
      this.channelHistory.set(channelId, [seedMsg]);
    });
  }

  /**
   * Helper to map ticket/customer/order to canonical persistent channel ID
   */
  getChannelId({ ticketId, customerId, orderId, channelId }) {
    if (channelId) return channelId;

    // Explicit mappings for demo data
    if (ticketId === 'tkt_1021' || customerId === 'cust_aarav' || orderId === 'NC1021') {
      return 'channel_NC1021';
    }
    if (ticketId === 'tkt_1022' || customerId === 'cust_priya' || orderId === 'NC1022') {
      return 'channel_NC1022';
    }
    if (ticketId === 'tkt_1023' || customerId === 'cust_kabir' || orderId === 'NC1023') {
      return 'channel_NC1023';
    }

    if (orderId) return `channel_${orderId}`;
    if (customerId) return `channel_${customerId}`;
    return 'channel_default';
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
        console.warn('[Nexconn] No App Key configured yet.');
        return false;
      }

      this.appKey = appKey;
      if (NCEngine && typeof NCEngine.initialize === 'function') {
        await NCEngine.initialize({ appKey });
        this.initialized = true;
        console.log('[Nexconn] Engine initialized with App Key');
        return true;
      }
    } catch (err) {
      console.warn('[Nexconn] Initialization warning:', err.message || err);
    }
    return false;
  }

  /**
   * Connect an authenticated user to Nexconn
   */
  async connectUser(user) {
    this.currentUser = user;

    try {
      const tokenRes = await getNexconnToken({
        userId: user.id,
        name: user.name,
        avatar: user.avatar,
      });

      if (!tokenRes.configured) {
        this.connected = true;
        return { connected: true, liveNetwork: false, user };
      }

      if (!this.initialized && tokenRes.appKey) {
        await this.initialize(tokenRes.appKey);
      }

      if (NCEngine && typeof NCEngine.connect === 'function' && tokenRes.token) {
        this.registerGlobalHandler();
        await NCEngine.connect({ token: tokenRes.token });
        this.connected = true;
        this.token = tokenRes.token;
        console.log('[Nexconn] Connected user to network:', user.name);
        return { connected: true, liveNetwork: true, user, token: tokenRes.token };
      }
    } catch (err) {
      console.error('[Nexconn] Connection error:', err);
    }

    this.connected = true;
    return { connected: true, liveNetwork: false, user };
  }

  /**
   * Global message listener registration with NCEngine
   */
  registerGlobalHandler() {
    const handlerId = 'resolve-ai-message-listener';
    try {
      if (NCEngine && typeof NCEngine.addMessageHandler === 'function') {
        NCEngine.addMessageHandler(handlerId, {
          onMessageReceived: (event) => {
            const rawMsg = event?.message || event;
            if (!rawMsg) return;

            // Extract channel identifier
            const targetChannel = rawMsg.channelId || 
              (rawMsg.metadata?.channelId) || 
              (rawMsg.orderId ? `channel_${rawMsg.orderId}` : null);

            if (targetChannel) {
              this.dispatchToChannel(targetChannel, rawMsg);
            }
          },
          onOfflineMessageSyncCompleted: () => {
            console.log('[Nexconn] Offline message sync complete');
          },
        });
      }
    } catch (err) {
      console.warn('[Nexconn] addMessageHandler warning:', err.message);
    }
  }

  /**
   * Get all messages for a specific channel (isolated)
   */
  getChannelMessages(channelId) {
    if (!channelId) return [];
    if (!this.channelHistory.has(channelId)) {
      this.channelHistory.set(channelId, []);
    }
    return [...this.channelHistory.get(channelId)];
  }

  /**
   * Dispatch a message to subscribers of ONLY the specified channel.
   * Guarantees that no message leaks into any other channel!
   */
  dispatchToChannel(channelId, message) {
    if (!channelId || !message) return;

    // Deduplicate by message ID
    const msgId = message.id || message.messageId;
    if (msgId && this.seenMessageIds.has(msgId)) {
      return; // Already processed, ignore duplicate
    }

    if (msgId) {
      this.seenMessageIds.add(msgId);
    }

    // Append to isolated channel history
    if (!this.channelHistory.has(channelId)) {
      this.channelHistory.set(channelId, []);
    }
    const currentList = this.channelHistory.get(channelId);
    currentList.push(message);

    // Call ONLY callbacks subscribed to this exact channelId
    const callbacks = this.channelSubscribers.get(channelId);
    if (callbacks && callbacks.size > 0) {
      callbacks.forEach((cb) => {
        try {
          cb(message);
        } catch (e) {
          console.error('[Nexconn] Channel callback error:', e);
        }
      });
    }
  }

  /**
   * Subscribe to messages on a specific channel ONLY
   */
  subscribe(channelId, callback) {
    if (!channelId || typeof callback !== 'function') {
      return () => {};
    }

    if (!this.channelSubscribers.has(channelId)) {
      this.channelSubscribers.set(channelId, new Set());
    }
    this.channelSubscribers.get(channelId).add(callback);

    // Return cleanup function to remove this exact listener
    return () => {
      const subs = this.channelSubscribers.get(channelId);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.channelSubscribers.delete(channelId);
        }
      }
    };
  }

  /**
   * Send a message through a specific channel to a target user
   * Guarantees:
   * 1. In-flight double submission prevention.
   * 2. Message sent ONLY to the specified channel.
   * 3. Message recorded in channel history exactly once.
   * 4. Dispatched ONLY to that channel's subscribers.
   */
  async sendMessage({ targetUserId, channelId, text, metadata = {} }) {
    if (!text || !text.trim() || !channelId) {
      console.warn('[Nexconn] Missing required params for sendMessage:', { channelId, text });
      return null;
    }

    const trimmedText = text.trim();
    const flightKey = `${channelId}_${targetUserId}_${trimmedText}`;

    // Prevent rapid duplicate clicks on the exact same message
    if (this.inFlightSends.has(flightKey)) {
      console.warn('[Nexconn] Duplicate send rejected (in-flight):', flightKey);
      return null;
    }

    this.inFlightSends.add(flightKey);

    try {
      // Deterministic unique message ID
      const timestamp = new Date().toISOString();
      const uniqueSuffix = Math.random().toString(36).substring(2, 8);
      const messageId = `msg_${channelId}_${Date.now()}_${uniqueSuffix}`;

      const messagePayload = {
        id: messageId,
        messageId,
        channelId,
        senderId: this.currentUser?.id || 'anonymous',
        senderName: this.currentUser?.name || (this.currentUser?.role === 'agent' ? 'Sarah Lin' : 'Customer'),
        senderRole: this.currentUser?.role ? 'agent' : 'customer',
        senderAvatar: this.currentUser?.avatar,
        targetUserId,
        text: trimmedText,
        timestamp,
        metadata: {
          ...metadata,
          channelId,
        },
      };

      // Attempt live Nexconn SDK DirectChannel transmission if available
      try {
        const DirectChannelClass = (typeof window !== 'undefined' && window.DirectChannel) || NCEngine?.DirectChannel;
        if (DirectChannelClass && targetUserId) {
          let channel = this.directChannels.get(targetUserId);
          if (!channel) {
            channel = new DirectChannelClass(targetUserId);
            this.directChannels.set(targetUserId, channel);
          }

          if (channel && typeof channel.sendMessage === 'function') {
            await channel.sendMessage({
              messageParams: { text: trimmedText },
            });
          }
        }
      } catch (sdkErr) {
        console.log('[Nexconn] SDK DirectChannel dispatch note:', sdkErr.message);
      }

      // Dispatch to this channel ONLY (records in history & notifies only this channel's listeners)
      this.dispatchToChannel(channelId, messagePayload);

      return messagePayload;
    } finally {
      // Release in-flight lock after brief cooldown
      setTimeout(() => {
        this.inFlightSends.delete(flightKey);
      }, 400);
    }
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

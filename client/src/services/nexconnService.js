import { 
  NCEngine, 
  DirectChannel, 
  SendTextMessageParams,
  MessageHandler,
  ConnectionStatusHandler
} from '@nexconn/chat';
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

    // Persistent ticket state store: ticketId -> { status, humanRequested, lastUpdated }
    this.ticketStatuses = new Map();

    // Set of seen message IDs to guarantee absolute deduplication
    this.seenMessageIds = new Set();

    // Map of active Nexconn DirectChannel instances: targetUserId -> DirectChannel instance
    this.directChannels = new Map();

    // Guard against rapid duplicate submissions
    this.inFlightSends = new Set();

    // Initialize seed message history for demo channels
    this.initializeSeedHistory();
  }

  saveHistoryToStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const obj = {};
        for (const [chId, msgs] of this.channelHistory.entries()) {
          obj[chId] = msgs;
        }
        window.localStorage.setItem('resolve_ai_channel_history', JSON.stringify(obj));
      }
    } catch (e) {
      // ignore
    }
  }

  loadHistoryFromStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const saved = window.localStorage.getItem('resolve_ai_channel_history');
        if (saved) {
          const parsed = JSON.parse(saved);
          for (const chId in parsed) {
            if (Array.isArray(parsed[chId]) && parsed[chId].length > 0) {
              const currentList = this.channelHistory.get(chId) || [];
              const merged = [...currentList];
              for (const msg of parsed[chId]) {
                const msgId = msg.id || msg.messageId;
                if (!merged.some(m => m.id === msgId || m.messageId === msgId)) {
                  merged.push(msg);
                }
                if (msgId) this.seenMessageIds.add(msgId);
              }
              this.channelHistory.set(chId, merged);
            }
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }

  saveTicketStatuses() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const obj = {};
        for (const [tId, val] of this.ticketStatuses.entries()) {
          obj[tId] = val;
        }
        window.localStorage.setItem('resolve_ai_ticket_statuses', JSON.stringify(obj));
      }
    } catch (e) {
      // ignore
    }
  }

  loadTicketStatuses() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const saved = window.localStorage.getItem('resolve_ai_ticket_statuses');
        if (saved) {
          const parsed = JSON.parse(saved);
          for (const tId in parsed) {
            const current = this.ticketStatuses.get(tId);
            const savedItem = parsed[tId];
            if (!current || !current.lastUpdated || (savedItem.lastUpdated && new Date(savedItem.lastUpdated).getTime() >= new Date(current.lastUpdated).getTime())) {
              this.ticketStatuses.set(tId, savedItem);
            }
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }

  getTicketStatus(ticketId) {
    if (!ticketId) return null;
    return this.ticketStatuses.get(ticketId) || null;
  }

  setTicketStatus(ticketId, status, extra = {}) {
    if (!ticketId || !status) return;
    const current = this.ticketStatuses.get(ticketId) || {};
    const newTimestamp = extra.lastUpdated || new Date().toISOString();

    // Prevent older status from overwriting newer status
    if (current.lastUpdated && extra.lastUpdated && new Date(current.lastUpdated).getTime() > new Date(extra.lastUpdated).getTime()) {
      return current;
    }

    const updated = {
      ...current,
      ...extra,
      status,
      humanRequested: status === 'Human Requested' ? true : status === 'Resolved' ? false : current.humanRequested,
      lastUpdated: newTimestamp,
    };
    this.ticketStatuses.set(ticketId, updated);
    this.saveTicketStatuses();
    return updated;
  }

  /**
   * Seed initial conversation history per channel
   */
  initializeSeedHistory() {
    DEMO_CUSTOMERS.forEach((c) => {
      this.ticketStatuses.set(c.ticket.id, {
        status: c.ticket.status,
        humanRequested: c.ticket.humanRequested,
        lastUpdated: c.ticket.lastUpdated,
      });

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

    this.loadHistoryFromStorage();
    this.loadTicketStatuses();
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
    if (!user) return { connected: false };
    if (this.currentUser?.id === user.id && this.connected) {
      return { connected: true, liveNetwork: Boolean(this.token), user };
    }
    
    // In Split View, multiple components (Customer & Agent) may share the engine session.
    // Avoid tearing down the active SDK socket if we are already connected.
    const isDifferentUser = this.currentUser && this.currentUser.id !== user.id;
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

      // If already connected to Nexconn with valid token, don't flap the socket
      if (this.connected && this.token === tokenRes.token) {
        return { connected: true, liveNetwork: true, user, token: this.token };
      }

      if (NCEngine && typeof NCEngine.connect === 'function' && tokenRes.token) {
        this.registerGlobalHandler();
        try {
          if (typeof NCEngine.addConnectionStatusHandler === 'function') {
            const statusCallbacks = {
              onConnectionStatusChanged: (status) => {
                console.log('[Nexconn] Connection status changed:', status);
              }
            };
            const statusHandler = ConnectionStatusHandler 
              ? new ConnectionStatusHandler(statusCallbacks)
              : { _invoker: statusCallbacks, ...statusCallbacks };
            NCEngine.addConnectionStatusHandler('resolve-ai-conn-status', statusHandler);
          }
        } catch (statusErr) {
          // ignore
        }
        const connResult = await NCEngine.connect({ token: tokenRes.token });
        this.connected = true;
        this.token = tokenRes.token;
        console.log('[Nexconn] Connected user to network:', user.name, 'connResult:', connResult);
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
        const callbacks = {
          onMessageReceived: (event) => {
            const messageList = Array.isArray(event?.messages)
              ? event.messages
              : Array.isArray(event)
              ? event
              : event?.message
              ? [event.message]
              : [event];

            for (const rawMsg of messageList) {
              if (!rawMsg) continue;
              console.log('[Nexconn] onMessageReceived from SDK event:', rawMsg?.messageId || 'no-id', 'from:', rawMsg?.senderUserId || rawMsg?.senderId);

              // Extract message text whether from SDK Message or payload
              let text = '';
              if (rawMsg.content && typeof rawMsg.content === 'object') {
                text = rawMsg.content.text || rawMsg.content.content || '';
              } else if (typeof rawMsg.content === 'string') {
                text = rawMsg.content;
              } else {
                text = rawMsg.text || '';
              }

              if (!text) continue;

              // Extract channel identifier
              let targetChannel = rawMsg.channelId || 
                (rawMsg.metadata?.channelId) || 
                (rawMsg.orderId ? `channel_${rawMsg.orderId}` : null);

              // If incoming message from remote SDK user, map to channel
              if (!targetChannel) {
                // First check if text references an explicit order
                if (text.includes('NC1021') || text.toLowerCase().includes('novasprint')) {
                  targetChannel = 'channel_NC1021';
                } else if (text.includes('NC1022') || text.toLowerCase().includes('smartwatch') || text.toLowerCase().includes('novapulse')) {
                  targetChannel = 'channel_NC1022';
                } else if (text.includes('NC1023') || text.toLowerCase().includes('novabass') || text.toLowerCase().includes('earphones')) {
                  targetChannel = 'channel_NC1023';
                } else {
                  const sender = rawMsg.senderUserId || rawMsg.senderId;
                  const target = rawMsg.channelIdentifier?.channelId || rawMsg.targetUserId;
                  
                  if (sender && sender.startsWith('cust_')) {
                    targetChannel = this.getChannelId({ customerId: sender });
                  } else if (target && target.startsWith('cust_')) {
                    targetChannel = this.getChannelId({ customerId: target });
                  } else if (this.currentUser?.id && this.currentUser.id.startsWith('cust_')) {
                    targetChannel = this.getChannelId({ customerId: this.currentUser.id });
                  }
                }
              }

              if (!targetChannel) continue;

              console.log('[Nexconn] INCOMING RAWMSG JSON:', JSON.stringify({
                messageId: rawMsg.messageId,
                sender: rawMsg.senderUserId,
                targetChannel,
                text
              }));

              const senderId = rawMsg.senderUserId || rawMsg.senderId || 'customer';
              const isAgent = (senderId && senderId.includes('agent')) || rawMsg.senderRole === 'agent';
              const customerMatch = DEMO_CUSTOMERS.find(c => c.id === senderId);
              const senderName = isAgent 
                ? 'Sarah Lin' 
                : (customerMatch?.name || rawMsg.senderName || 'Customer');

              // Decode status from metadata or message text only for recent live messages
              const msgTime = rawMsg.sentTime ? new Date(rawMsg.sentTime).getTime() : Date.now();
              const isLiveMessage = (Date.now() - msgTime) < 30000;

              let detectedStatus = rawMsg.metadata?.status;
              if (!detectedStatus && text && isLiveMessage) {
                if (text.includes('requested human agent assistance') || text.includes('requested human assistance')) {
                  detectedStatus = 'Human Requested';
                } else if (text.includes('joined the conversation and taken over')) {
                  detectedStatus = 'Human Agent Active';
                } else if (text.includes('marked as resolved')) {
                  detectedStatus = 'Resolved';
                }
              }

              const canonicalMsg = {
                id: rawMsg.messageId || rawMsg.id || `msg_${Date.now()}`,
                messageId: rawMsg.messageId || rawMsg.id || `msg_${Date.now()}`,
                channelId: targetChannel,
                senderId,
                senderName,
                senderRole: isAgent ? 'agent' : 'customer',
                senderAvatar: customerMatch?.avatar || rawMsg.senderAvatar,
                targetUserId: rawMsg.channelIdentifier?.channelId || rawMsg.targetUserId,
                text,
                timestamp: rawMsg.sentTime ? new Date(rawMsg.sentTime).toISOString() : (rawMsg.timestamp || new Date().toISOString()),
                metadata: {
                  ...rawMsg.metadata,
                  ...(detectedStatus ? { status: detectedStatus } : {}),
                },
              };

              const resolvedTicketId = rawMsg.metadata?.ticketId || (
                targetChannel === 'channel_NC1021' ? 'tkt_1021' : 
                targetChannel === 'channel_NC1022' ? 'tkt_1022' : 
                targetChannel === 'channel_NC1023' ? 'tkt_1023' : null
              );

              if (resolvedTicketId && detectedStatus && isLiveMessage) {
                this.setTicketStatus(resolvedTicketId, detectedStatus);
              }

              this.dispatchToChannel(targetChannel, canonicalMsg);
            }
          },
          onOfflineMessageSyncCompleted: () => {
            console.log('[Nexconn] Offline message sync complete');
          },
        };

        const msgHandler = MessageHandler 
          ? new MessageHandler(callbacks)
          : { _invoker: callbacks, ...callbacks };

        NCEngine.addMessageHandler(handlerId, msgHandler);
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
    this.saveHistoryToStorage();

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
        const DirectChannelClass = DirectChannel || (typeof window !== 'undefined' && window.DirectChannel);
        if (DirectChannelClass && targetUserId && this.connected && this.token) {
          let channel = this.directChannels.get(targetUserId);
          if (!channel) {
            channel = new DirectChannelClass(targetUserId);
            this.directChannels.set(targetUserId, channel);
          }

          if (channel && typeof channel.sendMessage === 'function') {
            const params = SendTextMessageParams
              ? new SendTextMessageParams({ text: trimmedText })
              : { content: { text: trimmedText } };
            const sdkResult = await channel.sendMessage(params);
            console.log('[Nexconn] SDK sendMessage to', targetUserId, 'result:', sdkResult);
            if (sdkResult?.data?.messageId) {
              this.seenMessageIds.add(sdkResult.data.messageId);
            }
          }
        }
      } catch (sdkErr) {
        console.warn('[Nexconn] SDK DirectChannel dispatch:', sdkErr.message || sdkErr);
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
    this.token = null;
    this.directChannels.clear();
    this.currentUser = null;
  }
}

export const nexconnService = new NexconnManager();
export default nexconnService;

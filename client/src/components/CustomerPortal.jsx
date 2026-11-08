import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  UserCheck, 
  ChevronDown, 
  ChevronUp,
  ShoppingBag
} from 'lucide-react';
import { DEMO_CUSTOMERS } from '../data/demoData';
import { requestHumanAssistance, getTicket } from '../services/api';
import nexconnService from '../services/nexconnService';

export default function CustomerPortal({ 
  customer, 
  onSelectCustomer, 
  onMessageSent,
  compact = false 
}) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [humanRequested, setHumanRequested] = useState(false);
  const [ticketStatus, setTicketStatus] = useState('AI Handling');
  const [showOrderDetails, setShowOrderDetails] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (!customer) return;

    const channelId = customer.channelId || `channel_${customer.order.orderId}`;
    const ticketId = customer.ticket?.id;

    nexconnService.connectUser({
      id: customer.id,
      name: customer.name,
      avatar: customer.avatar,
    });

    // 1. Immediately load isolated channel history from nexconnService
    setMessages(nexconnService.getChannelMessages(channelId));
    setInputText('');

    // 2. Set status from local store or demo defaults
    const storedStatus = nexconnService.getTicketStatus(ticketId);
    const initialStatus = storedStatus?.status || (
      customer.ticket?.humanRequested || customer.ticket?.status === 'Human Requested'
        ? 'Human Requested'
        : customer.ticket?.status === 'Resolved'
        ? 'Resolved'
        : customer.ticket?.status === 'Human Agent Active' || customer.ticket?.status === 'In Progress'
        ? 'Human Agent Active'
        : 'AI Handling'
    );
    
    setTicketStatus(initialStatus);
    setHumanRequested(initialStatus === 'Human Requested' || initialStatus === 'Human Agent Active');

    // Also fetch latest from backend
    if (ticketId) {
      getTicket(ticketId)
        .then((res) => {
          if (res?.ticket?.status) {
            const beStatus = res.ticket.status;
            setTicketStatus(beStatus);
            setHumanRequested(beStatus === 'Human Requested' || beStatus === 'Human Agent Active');
            nexconnService.setTicketStatus(ticketId, beStatus, { lastUpdated: res.ticket.lastUpdated });
          }
        })
        .catch(() => {});
    }

    // 3. Subscribe ONLY to this customer's persistent channel
    const unsubscribe = nexconnService.subscribe(channelId, (newMsg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === newMsg.id || (m.messageId && m.messageId === newMsg.messageId))) {
          return prev;
        }
        return [...prev, newMsg];
      });

      const msgTime = newMsg.timestamp ? new Date(newMsg.timestamp).getTime() : Date.now();
      const isLive = (Date.now() - msgTime) < 30000;

      let s = newMsg.metadata?.status;
      if (!s && newMsg.text && isLive) {
        if (newMsg.text.includes('requested human agent assistance') || newMsg.text.includes('requested human assistance')) {
          s = 'Human Requested';
        } else if (newMsg.text.includes('joined the conversation and taken over')) {
          s = 'Human Agent Active';
        } else if (newMsg.text.includes('marked as resolved')) {
          s = 'Resolved';
        }
      }

      if (s && isLive) {
        setTicketStatus(s);
        setHumanRequested(s === 'Human Requested' || s === 'Human Agent Active');
        if (ticketId) nexconnService.setTicketStatus(ticketId, s);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [customer?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if (!inputText.trim() || isSending) return;

    const textToSend = inputText.trim();
    const channelId = customer.channelId || `channel_${customer.order.orderId}`;
    setInputText('');
    setIsSending(true);

    try {
      const sentMsg = await nexconnService.sendMessage({
        targetUserId: 'agent_sarah',
        channelId,
        text: textToSend,
        metadata: {
          orderId: customer.order.orderId,
          ticketId: customer.ticket?.id,
        },
      });

      if (sentMsg) {
        setMessages(nexconnService.getChannelMessages(channelId));
        if (onMessageSent) {
          onMessageSent(sentMsg);
        }
      }
    } catch (err) {
      console.error('Error sending message:', err);
    } finally {
      setIsSending(false);
    }
  };

  const handleRequestHuman = async () => {
    if (humanRequested || ticketStatus === 'Human Requested' || ticketStatus === 'Human Agent Active') return;
    try {
      setHumanRequested(true);
      setTicketStatus('Human Requested');

      const ticketId = customer.ticket?.id;
      if (ticketId) {
        nexconnService.setTicketStatus(ticketId, 'Human Requested');
        await requestHumanAssistance(ticketId).catch(console.warn);
      }

      const channelId = customer.channelId || `channel_${customer.order.orderId}`;
      const systemNotice = {
        id: `sys_${channelId}_${Date.now()}`,
        messageId: `sys_${channelId}_${Date.now()}`,
        channelId,
        senderId: 'system',
        senderName: 'System',
        senderRole: 'system',
        text: 'Human assistance has been requested. Sarah Lin has been notified and will join this conversation shortly.',
        timestamp: new Date().toISOString(),
        metadata: {
          ticketId,
          status: 'Human Requested',
          type: 'STATUS_CHANGE',
        },
      };

      await nexconnService.sendMessage({
        targetUserId: 'agent_sarah',
        channelId,
        text: `Customer requested human agent assistance for order #${customer.order.orderId}.`,
        metadata: {
          ticketId,
          status: 'Human Requested',
          type: 'STATUS_CHANGE',
        },
      });

      nexconnService.dispatchToChannel(channelId, systemNotice);
      setMessages(nexconnService.getChannelMessages(channelId));
    } catch (err) {
      console.error('Failed to request human assistance:', err);
    }
  };

  const quickPrompts = [
    'Can you check the current tracking status?',
    'What is your return and refund window?',
    'I would like to speak with a human support agent.',
  ];

  return (
    <div className="flex flex-col h-full bg-[#0A0A0A] overflow-hidden">
      {/* Consolidated Single Header */}
      <div className="px-6 py-4 bg-[#0D0D0D] border-b border-[#1A1A1A] shrink-0 space-y-3">
        {/* Top Row: Brand & Persona Switcher */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[#161616] border border-[#262626] flex items-center justify-center text-[#7CFF00] shrink-0 shadow-sm">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-sm text-[#FFFFFF] tracking-tight">NovaCart Support</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold text-[#8A8A8A] bg-[#161616] border border-[#222222] hidden sm:inline">
                  Customer Experience
                </span>
              </div>
            </div>
          </div>

          {/* Persona Switcher Tabs (Synchronizes globally across entire app) */}
          <div className="flex items-center space-x-1.5 bg-[#141414] p-1 rounded-xl border border-[#222222] shrink-0">
            {DEMO_CUSTOMERS.map((c) => (
              <button
                key={c.id}
                onClick={() => onSelectCustomer(c)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  customer?.id === c.id
                    ? 'bg-[#7CFF00] text-[#090909] shadow-neon-sm font-bold'
                    : 'text-[#8A8A8A] hover:text-[#FFFFFF]'
                }`}
                title={`Switch to ${c.name}`}
              >
                {c.name.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Integrated Order Context Strip & Status Bar */}
        <div className="flex items-center justify-between pt-1.5 border-t border-[#161616] text-xs">
          <div className="flex items-center space-x-2 min-w-0">
            <span className="font-mono text-[#7CFF00] text-xs font-semibold shrink-0">
              #{customer?.order?.orderId}
            </span>
            <span className="text-[#333333]">·</span>
            <span className="text-[#A0A0A0] text-xs truncate hidden sm:inline">
              {customer?.order?.product}
            </span>
            <span className="text-[#333333] hidden sm:inline">·</span>
            <button
              onClick={() => setShowOrderDetails(!showOrderDetails)}
              className="text-[#8A8A8A] hover:text-[#7CFF00] underline text-xs flex items-center space-x-0.5 shrink-0 transition-colors"
            >
              <span>{showOrderDetails ? 'Hide tracking' : 'View tracking'}</span>
              {showOrderDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Status Indicator & Action */}
          <div className="flex items-center space-x-2 shrink-0">
            <span className="text-xs text-[#8A8A8A] font-medium hidden sm:inline mr-1">
              Status: <strong className={ticketStatus === 'Human Requested' ? 'text-[#FF334B]' : 'text-[#7CFF00]'}>{ticketStatus}</strong>
            </span>

            {ticketStatus === 'Resolved' ? (
              <span id="customer-status-badge-resolved" className="text-xs text-[#7CFF00] font-semibold px-2.5 py-0.5 rounded-full bg-[#7CFF00]/10 border border-[#7CFF00]/40">
                Resolved
              </span>
            ) : ticketStatus === 'Human Agent Active' ? (
              <span id="customer-status-badge-active" className="text-xs text-[#FFFFFF] font-semibold px-2.5 py-0.5 rounded-full bg-[#161616] border border-[#7CFF00]/40 flex items-center space-x-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#7CFF00] shadow-neon-sm" />
                <span>Sarah Lin Active</span>
              </span>
            ) : ticketStatus === 'Human Requested' ? (
              <span id="customer-status-badge-requested" className="text-xs text-[#FF334B] font-semibold px-2.5 py-0.5 rounded-full bg-[#250C10] border border-[#5C151F]">
                Human Requested
              </span>
            ) : (
              <button
                id="btn-request-human"
                onClick={handleRequestHuman}
                className="flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-[#161616] hover:bg-[#202020] text-[#FFFFFF] border border-[#262626] hover:border-[#7CFF00]/50 transition-colors shadow-sm"
              >
                <UserCheck className="w-3.5 h-3.5 text-[#7CFF00]" />
                <span>Request Human</span>
              </button>
            )}
          </div>
        </div>

        {/* Expandable Tracking Details */}
        {showOrderDetails && (
          <div className="p-3 rounded-xl bg-[#141414] border border-[#222222] text-xs text-[#8A8A8A] leading-relaxed animate-fadeIn">
            <div className="flex items-center justify-between text-[#8A8A8A] mb-1.5">
              <span>Delivery Status: <strong className="text-[#FFFFFF]">{customer?.order?.status}</strong></span>
              <span>Carrier: <strong className="text-[#FFFFFF]">{customer?.order?.carrier}</strong></span>
            </div>
            <span className="text-[#555555] block text-[10px] uppercase font-bold">Latest Courier Update</span>
            <span className="text-[#FFFFFF] text-xs">{customer?.order?.trackingStatus}</span>
          </div>
        )}
      </div>

      {/* Spacious Conversation Stream */}
      <div id="customer-chat-messages" className="flex-1 overflow-y-auto px-6 lg:px-8 py-6 space-y-4 bg-[#090909]">
        {messages.map((msg) => {
          const isMe = msg.senderRole === 'customer' || msg.senderId === customer?.id;
          const isSystem = msg.senderRole === 'system';

          if (isSystem) {
            return (
              <div key={msg.id} className="flex justify-center my-3">
                <div className="px-4 py-1.5 rounded-full bg-[#141414] border border-[#222222] text-xs text-[#8A8A8A] shadow-sm">
                  {msg.text}
                </div>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
            >
              <div className="flex items-center space-x-2 mb-1 px-1.5 text-xs text-[#8A8A8A]">
                <span className={isMe ? 'text-[#7CFF00] font-semibold' : 'text-[#FFFFFF] font-semibold'}>
                  {isMe ? 'You' : msg.senderName || 'Support Agent'}
                </span>
                <span>·</span>
                <span className="font-mono text-[11px]">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              <div
                className={`max-w-[72%] rounded-2xl px-5 py-3 text-[14px] leading-relaxed ${
                  isMe
                    ? 'bg-[#141414] border border-[#7CFF00]/40 text-[#FFFFFF] shadow-sm'
                    : 'bg-[#1A1A1A] border border-[#262626] text-[#FFFFFF]'
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.text}</p>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Optional Compact Quick Suggestion Prompts */}
      <div className="px-6 py-2 bg-[#0D0D0D] border-t border-[#181818] flex items-center space-x-2 overflow-x-auto no-scrollbar shrink-0">
        <span className="text-[11px] text-[#555555] shrink-0 font-bold uppercase">Quick ask:</span>
        {quickPrompts.map((prompt, i) => (
          <button
            key={i}
            onClick={() => setInputText(prompt)}
            className="text-xs whitespace-nowrap bg-[#141414] hover:bg-[#1E1E1E] text-[#8A8A8A] hover:text-[#FFFFFF] hover:border-[#7CFF00]/40 px-3 py-1 rounded-full border border-[#222222] transition-colors"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Fixed Composer at Bottom */}
      <form onSubmit={handleSendMessage} className="p-4 bg-[#0D0D0D] border-t border-[#1A1A1A] flex items-center space-x-3 shrink-0">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={ticketStatus === 'Resolved' ? "Inquiry resolved · Type your message to re-open..." : "Type your message..."}
          disabled={isSending}
          className="flex-1 bg-[#141414] border border-[#222222] focus:border-[#7CFF00] rounded-xl px-4 py-2.5 text-sm text-[#FFFFFF] placeholder-[#666666] focus:outline-none transition-colors disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!inputText.trim() || isSending}
          className="px-5 py-2.5 rounded-xl bg-[#7CFF00] hover:bg-[#8EFF1F] text-[#090909] text-xs font-bold flex items-center space-x-1.5 transition-all shadow-neon-sm disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <span>{isSending ? 'Sending...' : 'Send'}</span>
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}
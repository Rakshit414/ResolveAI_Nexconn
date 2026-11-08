import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  UserCheck, 
  ChevronDown, 
  ChevronUp
} from 'lucide-react';
import { DEMO_CUSTOMERS } from '../data/demoData';
import { requestHumanAssistance, getTicket } from '../services/api';
import nexconnService from '../services/nexconnService';

export default function CustomerPortal({ customer, onSelectCustomer, onMessageSent }) {
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

    // 1. Load exact isolated channel history from nexconnService
    setMessages(nexconnService.getChannelMessages(channelId));
    
    // 2. Set status from local store or demo defaults
    const storedStatus = nexconnService.getTicketStatus(ticketId);
    const initialStatus = storedStatus?.status || (
      customer.ticket.humanRequested || customer.ticket.status === 'Human Requested'
        ? 'Human Requested'
        : customer.ticket.status === 'Resolved'
        ? 'Resolved'
        : customer.ticket.status === 'Human Agent Active' || customer.ticket.status === 'In Progress'
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
            nexconnService.setTicketStatus(ticketId, beStatus);
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

    // Cleanup: unsubscribe when customer changes or component unmounts
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
          ticketId: customer.ticket.id,
        },
      });

      if (sentMsg) {
        // Sync message list from isolated channel store
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

      // Broadcast over real Nexconn connection to Agent Sarah
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
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-3">
      {/* Top Customer & Order Summary Card */}
      <div className="bg-[#0E0E0E] border border-[#222222] rounded p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-sm text-[#FFFFFF]">NovaCart Support</span>
              <span className="text-[10px] text-[#7CFF00] font-mono">Order {customer?.order?.orderId}</span>
            </div>
            <p className="text-xs text-[#8A8A8A] mt-0.5">{customer?.order?.product}</p>
          </div>

          {/* Customer switch tabs */}
          <div className="flex items-center space-x-1.5 bg-[#161616] p-1 rounded border border-[#222222]">
            {DEMO_CUSTOMERS.map((c) => (
              <button
                key={c.id}
                onClick={() => onSelectCustomer(c)}
                className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                  customer?.id === c.id
                    ? 'bg-[#7CFF00] text-[#090909] shadow-neon-sm'
                    : 'text-[#8A8A8A] hover:text-[#FFFFFF]'
                }`}
              >
                {c.name.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Collapsible Order Information */}
        <div className="mt-3 pt-3 border-t border-[#1C1C1C] flex items-center justify-between text-xs text-[#8A8A8A]">
          <div className="flex items-center space-x-3">
            <span>Status: <strong className="text-[#FFFFFF]">{customer?.order?.status}</strong></span>
            <span>·</span>
            <span>Carrier: <strong className="text-[#FFFFFF]">{customer?.order?.carrier}</strong></span>
          </div>

          <button
            onClick={() => setShowOrderDetails(!showOrderDetails)}
            className="text-[#8A8A8A] hover:text-[#7CFF00] underline flex items-center space-x-1 transition-colors"
          >
            <span>{showOrderDetails ? 'Less info' : 'View tracking info'}</span>
            {showOrderDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {showOrderDetails && (
          <div className="mt-2.5 p-2.5 rounded bg-[#161616] border border-[#222222] text-xs text-[#8A8A8A] leading-relaxed">
            <span className="text-[#555555] block text-[10px] uppercase font-bold">Latest Tracking Note</span>
            <span className="text-[#FFFFFF]">{customer?.order?.trackingStatus}</span>
          </div>
        )}
      </div>

      {/* Main Support Chat Interface */}
      <div className="bg-[#0E0E0E] border border-[#222222] rounded overflow-hidden flex flex-col h-[520px]">
        {/* Support Chat Header */}
        <div className="px-4 py-2.5 bg-[#0E0E0E] border-b border-[#222222] flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <span className="w-2 h-2 rounded-full bg-[#7CFF00] shadow-neon-sm" />
            <span className="font-semibold text-xs text-[#FFFFFF]">Customer Care Desk</span>
          </div>

          <div className="flex items-center space-x-3">
            {/* Clean Status Display */}
            <span className="text-xs text-[#8A8A8A] flex items-center space-x-1">
              <span>Status:</span>
              <strong className={
                ticketStatus === 'Human Requested' ? 'text-[#FF334B]' : 'text-[#7CFF00]'
              }>
                {ticketStatus}
              </strong>
            </span>

            {/* Request Human Action */}
            {ticketStatus === 'Resolved' ? (
              <span id="customer-status-badge-resolved" className="text-[11px] text-[#7CFF00] font-semibold px-2 py-0.5 rounded bg-[#7CFF00]/10 border border-[#7CFF00]/40">
                Resolved
              </span>
            ) : ticketStatus === 'Human Agent Active' ? (
              <span id="customer-status-badge-active" className="text-[11px] text-[#FFFFFF] font-semibold px-2 py-0.5 rounded bg-[#161616] border border-[#7CFF00]/40 flex items-center space-x-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#7CFF00] shadow-neon-sm" />
                <span>Sarah Lin Active</span>
              </span>
            ) : ticketStatus === 'Human Requested' ? (
              <span id="customer-status-badge-requested" className="text-[11px] text-[#FF334B] font-semibold px-2 py-0.5 rounded bg-[#250C10] border border-[#5C151F]">
                Human Requested
              </span>
            ) : (
              <button
                id="btn-request-human"
                onClick={handleRequestHuman}
                className="flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-semibold bg-[#161616] hover:bg-[#202020] text-[#FFFFFF] border border-[#222222] hover:border-[#7CFF00]/40 transition-colors"
              >
                <UserCheck className="w-3.5 h-3.5 text-[#7CFF00]" />
                <span>Request Human</span>
              </button>
            )}
          </div>
        </div>

        {/* Chat Messages Stream */}
        <div id="customer-chat-messages" className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-[#090909]">
          {messages.map((msg) => {
            const isMe = msg.senderRole === 'customer' || msg.senderId === customer?.id;
            const isSystem = msg.senderRole === 'system';

            if (isSystem) {
              return (
                <div key={msg.id} className="flex justify-center my-2">
                  <div className="px-3 py-1 rounded bg-[#161616] border border-[#222222] text-[11px] text-[#8A8A8A]">
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
                <div className="flex items-center space-x-1.5 mb-1 text-[11px] text-[#8A8A8A] px-1">
                  <span className={isMe ? 'text-[#7CFF00] font-semibold' : 'text-[#FFFFFF] font-semibold'}>
                    {isMe ? 'You' : msg.senderName || 'Support Agent'}
                  </span>
                  <span>·</span>
                  <span className="text-[10px] font-mono">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <div
                  className={`max-w-[80%] rounded px-3.5 py-2 text-xs leading-relaxed ${
                    isMe
                      ? 'bg-[#161616] border border-[#7CFF00]/40 text-[#FFFFFF]'
                      : 'bg-[#1C1C1C] border border-[#282828] text-[#FFFFFF]'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Suggestion Chips */}
        <div className="px-3 py-1.5 bg-[#0E0E0E] border-t border-[#1C1C1C] flex items-center space-x-1.5 overflow-x-auto no-scrollbar">
          <span className="text-[11px] text-[#555555] shrink-0 font-bold uppercase">Quick ask:</span>
          {quickPrompts.map((prompt, i) => (
            <button
              key={i}
              onClick={() => setInputText(prompt)}
              className="text-[11px] whitespace-nowrap bg-[#161616] hover:bg-[#202020] text-[#8A8A8A] hover:text-[#FFFFFF] hover:border-[#7CFF00]/40 px-2 py-0.5 rounded border border-[#222222] transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Composer */}
        <form onSubmit={handleSendMessage} className="p-2.5 bg-[#0E0E0E] border-t border-[#222222] flex items-center space-x-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={ticketStatus === 'Resolved' ? "Inquiry resolved · Type a message to re-open..." : "Type your message..."}
            disabled={isSending}
            className="flex-1 bg-[#161616] border border-[#222222] focus:border-[#7CFF00] rounded px-3 py-2 text-xs text-[#FFFFFF] placeholder-[#8A8A8A] focus:outline-none transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isSending}
            className="px-3.5 py-2 rounded bg-[#7CFF00] hover:bg-[#8EFF1F] text-[#090909] text-xs font-bold flex items-center space-x-1.5 transition-all shadow-neon-sm disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <span>{isSending ? 'Sending...' : 'Send'}</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Package, 
  UserCheck, 
  ChevronDown, 
  ChevronUp,
  Clock,
  CheckCircle2
} from 'lucide-react';
import { DEMO_CUSTOMERS } from '../data/demoData';
import { requestHumanAssistance } from '../services/api';
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

    nexconnService.connectUser({
      id: customer.id,
      name: customer.name,
      avatar: customer.avatar,
    });

    const initialMsgs = [
      {
        id: `msg_init_${customer.id}`,
        senderId: customer.id,
        senderName: customer.name,
        senderRole: 'customer',
        senderAvatar: customer.avatar,
        text: customer.order.initialMessage,
        timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
      }
    ];

    setMessages(initialMsgs);
    
    // Status mapping
    const isHandoff = customer.ticket.humanRequested || 
      customer.ticket.status === 'Human Requested' || 
      customer.ticket.status === 'Human Assistance Requested';
    setHumanRequested(isHandoff);

    const initialStatus = isHandoff
      ? 'Human Requested'
      : customer.ticket.status === 'Resolved'
      ? 'Resolved'
      : customer.ticket.status === 'Human Agent Active' || customer.ticket.status === 'In Progress'
      ? 'Human Agent Active'
      : 'AI Handling';
    setTicketStatus(initialStatus);

    const unsubscribe = nexconnService.subscribe(`channel_${customer.order.orderId}`, (newMsg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });

      if (newMsg.senderRole === 'agent') {
        setTicketStatus('Human Agent Active');
      }
    });

    return () => {
      unsubscribe();
    };
  }, [customer]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if (!inputText.trim() || isSending) return;

    const textToSend = inputText.trim();
    setInputText('');
    setIsSending(true);

    try {
      const sentMsg = await nexconnService.sendMessage(
        'agent_sarah',
        textToSend,
        {
          orderId: customer.order.orderId,
          channelId: `channel_${customer.order.orderId}`,
        }
      );

      if (sentMsg) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === sentMsg.id)) return prev;
          return [...prev, sentMsg];
        });

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
    try {
      setHumanRequested(true);
      setTicketStatus('Human Requested');

      await requestHumanAssistance(customer.ticket.id);

      const systemNotice = {
        id: `sys_${Date.now()}`,
        senderId: 'system',
        senderName: 'System',
        senderRole: 'system',
        text: 'Human assistance has been requested. A support agent will connect with you shortly.',
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, systemNotice]);
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
      <div className="bg-[#111311] border border-[#353B35] rounded p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-sm text-[#D5D9D3]">NovaCart Support</span>
              <span className="text-[10px] text-[#929A91] font-mono">Order {customer?.order?.orderId}</span>
            </div>
            <p className="text-xs text-[#929A91] mt-0.5">{customer?.order?.product}</p>
          </div>

          {/* Customer switch tabs */}
          <div className="flex items-center space-x-1.5 bg-[#191A19] p-1 rounded border border-[#353B35]">
            {DEMO_CUSTOMERS.map((c) => (
              <button
                key={c.id}
                onClick={() => onSelectCustomer(c)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  customer?.id === c.id
                    ? 'bg-[#174B35] text-[#D5D9D3]'
                    : 'text-[#929A91] hover:text-[#D5D9D3]'
                }`}
              >
                {c.name.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Collapsible Order Information */}
        <div className="mt-3 pt-3 border-t border-[#353B35]/50 flex items-center justify-between text-xs text-[#929A91]">
          <div className="flex items-center space-x-3">
            <span>Status: <strong className="text-[#D5D9D3]">{customer?.order?.status}</strong></span>
            <span>·</span>
            <span>Carrier: <strong className="text-[#D5D9D3]">{customer?.order?.carrier}</strong></span>
          </div>

          <button
            onClick={() => setShowOrderDetails(!showOrderDetails)}
            className="text-[#929A91] hover:text-[#D5D9D3] underline flex items-center space-x-1"
          >
            <span>{showOrderDetails ? 'Less info' : 'View tracking info'}</span>
            {showOrderDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {showOrderDetails && (
          <div className="mt-2.5 p-2.5 rounded bg-[#191A19] border border-[#353B35] text-xs text-[#929A91] leading-relaxed">
            <span className="text-[#687267] block text-[10px] uppercase font-semibold">Latest Tracking Note</span>
            <span className="text-[#D5D9D3]">{customer?.order?.trackingStatus}</span>
          </div>
        )}
      </div>

      {/* Main Support Chat Interface */}
      <div className="bg-[#111311] border border-[#353B35] rounded overflow-hidden flex flex-col h-[520px]">
        {/* Support Chat Header */}
        <div className="px-4 py-2.5 bg-[#111311] border-b border-[#353B35] flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <span className="w-2 h-2 rounded-full bg-[#174B35]" />
            <span className="font-medium text-xs text-[#D5D9D3]">Customer Care Desk</span>
          </div>

          <div className="flex items-center space-x-3">
            {/* Clean Status Display */}
            <span className="text-xs text-[#929A91] flex items-center space-x-1">
              <span>Status:</span>
              <strong className={
                ticketStatus === 'Human Requested' ? 'text-[#A51F32]' : 'text-[#D5D9D3]'
              }>
                {ticketStatus}
              </strong>
            </span>

            {/* Request Human Action */}
            {!humanRequested ? (
              <button
                onClick={handleRequestHuman}
                className="flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-medium bg-[#191A19] hover:bg-[#242724] text-[#D5D9D3] border border-[#353B35] transition-colors"
              >
                <UserCheck className="w-3.5 h-3.5 text-[#929A91]" />
                <span>Request Human</span>
              </button>
            ) : (
              <span className="text-[11px] text-[#A51F32] font-medium px-2 py-0.5 rounded bg-[#2A1316] border border-[#5C1721]">
                Human Requested
              </span>
            )}
          </div>
        </div>

        {/* Chat Messages Stream */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-[#191A19]">
          {messages.map((msg) => {
            const isMe = msg.senderRole === 'customer' || msg.senderId === customer?.id;
            const isSystem = msg.senderRole === 'system';

            if (isSystem) {
              return (
                <div key={msg.id} className="flex justify-center my-2">
                  <div className="px-3 py-1 rounded bg-[#242724] border border-[#353B35] text-[11px] text-[#929A91]">
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
                <div className="flex items-center space-x-1.5 mb-1 text-[11px] text-[#929A91] px-1">
                  <span>{isMe ? 'You' : msg.senderName || 'Support Agent'}</span>
                  <span>·</span>
                  <span className="text-[10px] font-mono">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <div
                  className={`max-w-[80%] rounded px-3.5 py-2 text-xs leading-relaxed ${
                    isMe
                      ? 'bg-[#142E22] border border-[#235D43] text-[#D5D9D3]'
                      : 'bg-[#242724] border border-[#353B35] text-[#D5D9D3]'
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
        <div className="px-3 py-1.5 bg-[#111311] border-t border-[#353B35]/60 flex items-center space-x-1.5 overflow-x-auto no-scrollbar">
          <span className="text-[11px] text-[#687267] shrink-0 font-medium">Quick ask:</span>
          {quickPrompts.map((prompt, i) => (
            <button
              key={i}
              onClick={() => setInputText(prompt)}
              className="text-[11px] whitespace-nowrap bg-[#191A19] hover:bg-[#242724] text-[#929A91] hover:text-[#D5D9D3] px-2 py-0.5 rounded border border-[#353B35] transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Composer */}
        <form onSubmit={handleSendMessage} className="p-2.5 bg-[#111311] border-t border-[#353B35] flex items-center space-x-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 bg-[#191A19] border border-[#353B35] focus:border-[#174B35] rounded px-3 py-2 text-xs text-[#D5D9D3] placeholder-[#929A91] focus:outline-none transition-colors"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isSending}
            className="px-3.5 py-2 rounded bg-[#174B35] hover:bg-[#1F6246] text-[#D5D9D3] text-xs font-medium flex items-center space-x-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <span>Send</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  UserCheck, 
  Package, 
  Clock, 
  AlertCircle, 
  CheckCircle, 
  Headphones, 
  ChevronRight,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import { DEMO_CUSTOMERS } from '../data/demoData';
import { requestHumanAssistance } from '../services/api';
import nexconnService from '../services/nexconnService';

export default function CustomerPortal({ customer, onSelectCustomer, onMessageSent }) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [humanRequested, setHumanRequested] = useState(false);
  const [ticketStatus, setTicketStatus] = useState('Open');
  const [isAgentTyping, setIsAgentTyping] = useState(false);
  const messagesEndRef = useRef(null);

  // Load customer initial conversation and state
  useEffect(() => {
    if (!customer) return;

    // Connect customer via Nexconn
    nexconnService.connectUser({
      id: customer.id,
      name: customer.name,
      avatar: customer.avatar,
    });

    // Initial conversation history seed
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
    setHumanRequested(customer.ticket.humanRequested);
    setTicketStatus(customer.ticket.status);

    // Subscribe to incoming messages from Nexconn
    const unsubscribe = nexconnService.subscribe(`channel_${customer.order.orderId}`, (newMsg) => {
      setMessages((prev) => {
        // avoid duplicate messages
        if (prev.some((m) => m.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });

      if (newMsg.senderRole === 'agent') {
        setTicketStatus('In Progress');
      }
    });

    return () => {
      unsubscribe();
    };
  }, [customer]);

  // Scroll to bottom on new message
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
      setTicketStatus('Human Assistance Requested');

      await requestHumanAssistance(customer.ticket.id);

      // Add system message into chat
      const systemNotice = {
        id: `sys_${Date.now()}`,
        senderId: 'system',
        senderName: 'System Notice',
        senderRole: 'system',
        text: 'A human support specialist has been requested. Agent Sarah Lin has been notified with high priority.',
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, systemNotice]);
    } catch (err) {
      console.error('Failed to request human assistance:', err);
    }
  };

  // Quick reply prompt chips
  const quickPrompts = [
    'Can you check the current tracking status?',
    'What is your return and refund window?',
    'I need to talk to a human agent please.',
  ];

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
      {/* Top Customer Account Switcher Bar */}
      <div className="bg-[#0B1120] border border-slate-800 rounded-2xl p-4 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-indigo">
              Customer Support Portal
            </span>
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center space-x-2">
              <span>NovaCart Help Center</span>
              <span className="text-xs font-normal text-slate-400">· Order Assistance</span>
            </h1>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-400 hidden sm:inline">Active Demo User:</span>
            <div className="flex items-center bg-slate-900 border border-slate-750 rounded-xl p-1">
              {DEMO_CUSTOMERS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onSelectCustomer(c)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    customer?.id === c.id
                      ? 'bg-brand-indigo text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {c.name.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Order Context Banner */}
        {customer?.order && (
          <div className="mt-4 p-3.5 bg-slate-900/90 rounded-xl border border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-brand-indigo/15 border border-brand-indigo/30 flex items-center justify-center text-brand-indigo shrink-0">
                <Package className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-white">{customer.order.product}</span>
                  <span className="font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded text-[11px]">
                    {customer.order.orderId}
                  </span>
                </div>
                <div className="text-slate-400 text-[11px] mt-0.5">
                  Placed on {customer.order.purchaseDate} · ${customer.order.price.toFixed(2)}
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-3 text-[11px]">
              <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-slate-300">Status: <strong className="text-white">{customer.order.status}</strong></span>
              </div>
              <div className="text-slate-400 hidden sm:block">
                Carrier: <span className="text-slate-300">{customer.order.carrier}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Support Chat Interface */}
      <div className="bg-[#0B1120] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[600px]">
        {/* Chat Header */}
        <div className="bg-slate-900/90 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="relative">
              <div className="w-9 h-9 rounded-full bg-brand-indigo/20 flex items-center justify-center text-brand-indigo font-bold border border-brand-indigo/30">
                <Headphones className="w-5 h-5" />
              </div>
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-slate-900" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-sm text-white">NovaCart Resolution Desk</h3>
                <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Live Support
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Powered by Nexconn Chat SDK & Resolve AI Copilot</p>
            </div>
          </div>

          {/* Ticket Status & Human Handoff Action */}
          <div className="flex items-center space-x-2">
            <div className="text-right hidden sm:block">
              <div className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Ticket Status</div>
              <div className={`text-xs font-semibold ${
                ticketStatus === 'Human Assistance Requested'
                  ? 'text-amber-400'
                  : ticketStatus === 'Resolved'
                  ? 'text-emerald-400'
                  : 'text-brand-indigo'
              }`}>
                {ticketStatus}
              </div>
            </div>

            {!humanRequested ? (
              <button
                onClick={handleRequestHuman}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold transition-all shadow-sm"
              >
                <UserCheck className="w-3.5 h-3.5 text-amber-400" />
                <span>Request Human</span>
              </button>
            ) : (
              <span className="flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-medium">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span>Human Requested</span>
              </span>
            )}
          </div>
        </div>

        {/* Chat Messages Stream */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-[#080D1A]/60">
          {messages.map((msg) => {
            const isMe = msg.senderRole === 'customer' || msg.senderId === customer?.id;
            const isSystem = msg.senderRole === 'system';

            if (isSystem) {
              return (
                <div key={msg.id} className="flex justify-center my-3">
                  <div className="px-3 py-1.5 rounded-xl bg-slate-800/90 border border-slate-700/80 text-[11px] text-amber-300 flex items-center space-x-1.5 shadow-sm">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>{msg.text}</span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className={`flex items-end space-x-2.5 ${isMe ? 'justify-end' : 'justify-start'}`}
              >
                {!isMe && (
                  <img
                    src={msg.senderAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&q=80'}
                    alt={msg.senderName}
                    className="w-7 h-7 rounded-full object-cover border border-slate-700 shrink-0 mb-1"
                  />
                )}

                <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 shadow-md ${
                  isMe
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-br-sm'
                    : 'bg-slate-800/90 border border-slate-750 text-slate-100 rounded-bl-sm'
                }`}>
                  <div className="flex items-center justify-between space-x-3 mb-1">
                    <span className="text-[11px] font-semibold text-slate-300">
                      {isMe ? 'You' : msg.senderName || 'Agent Sarah Lin'}
                    </span>
                    {!isMe && (
                      <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded bg-brand-indigo/30 text-brand-indigo">
                        Support Agent
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                  <div className={`text-[10px] mt-1 text-right ${isMe ? 'text-blue-200/80' : 'text-slate-400'}`}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>

                {isMe && (
                  <img
                    src={customer?.avatar}
                    alt={customer?.name}
                    className="w-7 h-7 rounded-full object-cover border border-blue-500/40 shrink-0 mb-1"
                  />
                )}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Suggestion Chips */}
        <div className="px-4 py-2 bg-slate-900/60 border-t border-slate-800/60 flex items-center space-x-2 overflow-x-auto no-scrollbar">
          <span className="text-[11px] text-slate-400 font-medium shrink-0 flex items-center space-x-1">
            <Sparkles className="w-3 h-3 text-brand-indigo" />
            <span>Quick ask:</span>
          </span>
          {quickPrompts.map((prompt, i) => (
            <button
              key={i}
              onClick={() => setInputText(prompt)}
              className="text-[11px] whitespace-nowrap bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white px-2.5 py-1 rounded-lg border border-slate-700/70 transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Message Composer Form */}
        <form onSubmit={handleSendMessage} className="p-3 bg-slate-900 border-t border-slate-800 flex items-center space-x-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type your message to support..."
            className="flex-1 bg-slate-950 border border-slate-800 focus:border-brand-indigo rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none transition-colors"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isSending}
            className="px-4 py-2.5 rounded-xl bg-brand-indigo hover:bg-brand-violet text-white text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-glow-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span>Send</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}

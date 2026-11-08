import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Package, 
  CheckCircle2, 
  Clock, 
  ChevronDown, 
  ChevronUp, 
  ExternalLink,
  ShieldAlert,
  UserCheck,
  Bot
} from 'lucide-react';
import nexconnService from '../services/nexconnService';

export default function ChatWindow({
  ticket,
  messages,
  onSendMessage,
  onUpdateStatus,
}) {
  const [inputText, setInputText] = useState('');
  const [showOrderDetails, setShowOrderDetails] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e) => {
    e?.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const customer = ticket?.customer;
  const order = customer?.order;

  return (
    <div className="flex flex-col h-full bg-[#080D1A] overflow-hidden">
      {/* Chat Window Header */}
      <div className="px-5 py-3.5 bg-[#0B1120] border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <img
            src={customer?.avatar}
            alt={customer?.name}
            className="w-10 h-10 rounded-full object-cover border border-slate-700"
          />
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="font-bold text-sm text-white">{customer?.name}</h2>
              <span className="font-mono text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-750">
                {ticket?.orderId}
              </span>
            </div>
            <div className="flex items-center space-x-2 text-xs text-slate-400 mt-0.5">
              <span>{customer?.email}</span>
              <span>·</span>
              <span className="text-slate-300 font-medium">{order?.product}</span>
            </div>
          </div>
        </div>

        {/* Action Controls: Ticket Resolution State */}
        <div className="flex items-center space-x-2">
          {ticket?.status !== 'In Progress' && ticket?.status !== 'Resolved' && (
            <button
              onClick={() => onUpdateStatus('In Progress')}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-brand-indigo/20 hover:bg-brand-indigo/30 text-brand-indigo border border-brand-indigo/30 transition-colors"
            >
              Take Over (In Progress)
            </button>
          )}

          {ticket?.status !== 'Resolved' ? (
            <button
              onClick={() => onUpdateStatus('Resolved')}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Mark Resolved</span>
            </button>
          ) : (
            <span className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Resolved</span>
            </span>
          )}

          <button
            onClick={() => setShowOrderDetails(!showOrderDetails)}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-800 border border-slate-700 transition-colors"
            title="Toggle Order Context"
          >
            {showOrderDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expandable Order Details Drawer */}
      {showOrderDetails && order && (
        <div className="p-4 bg-slate-900 border-b border-slate-800 text-xs text-slate-300 animate-fadeIn grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Product</span>
            <span className="font-semibold text-white">{order.product}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Delivery Status</span>
            <span className="font-semibold text-amber-400">{order.status}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Carrier / Tracking</span>
            <span className="font-mono text-slate-200">{order.carrier} ({order.trackingNumber})</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Order Placed</span>
            <span className="text-slate-200">{order.purchaseDate} (${order.price.toFixed(2)})</span>
          </div>
          <div className="col-span-2 md:col-span-4 bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-[11px]">
            <strong className="text-slate-400">Logistics Detail: </strong>
            <span className="text-slate-300">{order.trackingStatus}</span>
          </div>
        </div>
      )}

      {/* Messages Stream */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
        {messages.map((msg) => {
          const isAgent = msg.senderRole === 'agent' || msg.senderId === 'agent_sarah';
          const isSystem = msg.senderRole === 'system';

          if (isSystem) {
            return (
              <div key={msg.id} className="flex justify-center my-2">
                <div className="px-3 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300">
                  {msg.text}
                </div>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`flex items-end space-x-2.5 ${isAgent ? 'justify-end' : 'justify-start'}`}
            >
              {!isAgent && (
                <img
                  src={customer?.avatar}
                  alt={customer?.name}
                  className="w-7 h-7 rounded-full object-cover border border-slate-700 shrink-0 mb-1"
                />
              )}

              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2.5 shadow-md ${
                  isAgent
                    ? 'bg-gradient-to-r from-brand-indigo to-brand-violet text-white rounded-br-sm'
                    : 'bg-slate-850 border border-slate-750 text-slate-100 rounded-bl-sm'
                }`}
              >
                <div className="flex items-center justify-between space-x-2 mb-1">
                  <span className="text-[11px] font-semibold text-slate-300">
                    {isAgent ? 'You (Sarah Lin)' : customer?.name}
                  </span>
                  {msg.metadata?.aiAssisted && (
                    <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded bg-purple-500/30 text-purple-200 border border-purple-400/30 flex items-center space-x-1">
                      <Bot className="w-2.5 h-2.5" />
                      <span>AI Copilot</span>
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                <div
                  className={`text-[10px] mt-1 text-right ${
                    isAgent ? 'text-indigo-200/80' : 'text-slate-400'
                  }`}
                >
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>

              {isAgent && (
                <img
                  src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&q=80"
                  alt="Sarah Lin"
                  className="w-7 h-7 rounded-full object-cover border border-brand-indigo shrink-0 mb-1"
                />
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Manual Message Input Composer */}
      <form onSubmit={handleSend} className="p-3 bg-[#0B1120] border-t border-slate-800 flex items-center space-x-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={`Reply to ${customer?.name || 'customer'} directly...`}
          className="flex-1 bg-slate-900 border border-slate-800 focus:border-brand-indigo rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none transition-colors"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          className="px-4 py-2.5 rounded-xl bg-brand-indigo hover:bg-brand-violet text-white text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-glow-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span>Send Reply</span>
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  ChevronDown, 
  ChevronUp, 
  Check, 
  UserCheck, 
  PanelRightClose,
  PanelRightOpen
} from 'lucide-react';

export default function ChatWindow({
  ticket,
  messages,
  onSendMessage,
  onUpdateStatus,
  isCopilotOpen,
  onToggleCopilot,
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

  // Status mapping
  const currentStatus = ticket?.status === 'Human Assistance Requested' || ticket?.status === 'Human Requested'
    ? 'Human Requested'
    : ticket?.status === 'In Progress' || ticket?.status === 'Human Agent Active'
    ? 'Human Agent Active'
    : ticket?.status === 'Resolved'
    ? 'Resolved'
    : 'AI Handling';

  const isHandoffRequested = currentStatus === 'Human Requested';
  const isAgentActive = currentStatus === 'Human Agent Active';
  const isResolved = currentStatus === 'Resolved';

  return (
    <div className="flex flex-col h-full bg-[#090909] overflow-hidden">
      {/* Workspace Header */}
      <div className="px-5 py-3 bg-[#0E0E0E] border-b border-[#222222] flex items-center justify-between shrink-0">
        {/* Customer & Order Summary */}
        <div className="flex items-center space-x-3">
          <img
            src={customer?.avatar}
            alt={customer?.name}
            className="w-8 h-8 rounded-full object-cover border border-[#282828] grayscale"
          />
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-xs text-[#FFFFFF]">{customer?.name}</span>
              <span className="text-[11px] text-[#8A8A8A] font-mono">({ticket?.orderId})</span>
              
              {/* Minimal Status Indicator */}
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                isHandoffRequested
                  ? 'border-[#5C151F] bg-[#250C10] text-[#FF334B]'
                  : isResolved
                  ? 'border-[#7CFF00]/40 bg-[#7CFF00]/10 text-[#7CFF00]'
                  : isAgentActive
                  ? 'border-[#282828] bg-[#161616] text-[#FFFFFF]'
                  : 'border-[#222222] text-[#8A8A8A]'
              }`}>
                {currentStatus}
              </span>
            </div>

            <div className="flex items-center space-x-2 text-[11px] text-[#8A8A8A] mt-0.5">
              <span>{order?.product}</span>
              <span>·</span>
              <button
                onClick={() => setShowOrderDetails(!showOrderDetails)}
                className="text-[#8A8A8A] hover:text-[#7CFF00] underline flex items-center space-x-0.5 transition-colors"
              >
                <span>{showOrderDetails ? 'Hide order' : 'Order details'}</span>
                {showOrderDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>
          </div>
        </div>

        {/* Action Controls: Take Over / Resolve / Toggle Copilot */}
        <div className="flex items-center space-x-2">
          {/* Take Over Button when human requested */}
          {isHandoffRequested && (
            <button
              onClick={() => onUpdateStatus('Human Agent Active')}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-bold bg-[#7CFF00] hover:bg-[#8EFF1F] text-[#090909] transition-all shadow-neon-sm"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Take Over</span>
            </button>
          )}

          {/* Mark Resolved Action */}
          {!isResolved ? (
            <button
              onClick={() => onUpdateStatus('Resolved')}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded text-xs font-medium text-[#8A8A8A] hover:text-[#FFFFFF] bg-[#161616] hover:bg-[#202020] border border-[#222222] hover:border-[#7CFF00]/40 transition-colors"
            >
              <Check className="w-3.5 h-3.5 text-[#7CFF00]" />
              <span>Resolve</span>
            </button>
          ) : (
            <span className="text-xs text-[#7CFF00] px-2.5 py-1 bg-[#7CFF00]/10 rounded border border-[#7CFF00]/30 font-medium">
              Resolved
            </span>
          )}

          {/* Toggle AI Copilot Panel */}
          <button
            onClick={onToggleCopilot}
            className={`p-1.5 rounded text-[#8A8A8A] hover:text-[#FFFFFF] border border-[#222222] transition-colors ${
              isCopilotOpen ? 'bg-[#161616] border-[#7CFF00]/40 text-[#7CFF00]' : 'bg-[#0E0E0E]'
            }`}
            title={isCopilotOpen ? 'Collapse AI Copilot' : 'Expand AI Copilot'}
          >
            {isCopilotOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Collapsible Order Information Banner */}
      {showOrderDetails && order && (
        <div className="px-5 py-3 bg-[#0E0E0E] border-b border-[#222222] text-xs text-[#8A8A8A] grid grid-cols-2 md:grid-cols-4 gap-4 animate-fadeIn">
          <div>
            <span className="block text-[10px] uppercase font-bold text-[#555555]">Item Ordered</span>
            <span className="text-[#FFFFFF] font-medium">{order.product}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase font-bold text-[#555555]">Delivery Status</span>
            <span className="text-[#7CFF00] font-medium">{order.status}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase font-bold text-[#555555]">Carrier & Tracking</span>
            <span className="text-[#FFFFFF] font-mono">{order.carrier} · {order.trackingNumber}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase font-bold text-[#555555]">Order Date & Price</span>
            <span className="text-[#FFFFFF]">{order.purchaseDate} (${order.price.toFixed(2)})</span>
          </div>
        </div>
      )}

      {/* Messages Stream - Generous readable spacing */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {messages.map((msg) => {
          const isAgent = msg.senderRole === 'agent' || msg.senderId === 'agent_sarah';
          const isSystem = msg.senderRole === 'system';

          if (isSystem) {
            return (
              <div key={msg.id} className="flex justify-center my-3">
                <div className="px-3 py-1 rounded bg-[#161616] border border-[#222222] text-[11px] text-[#8A8A8A]">
                  {msg.text}
                </div>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isAgent ? 'items-end' : 'items-start'}`}
            >
              {/* Message Meta Info */}
              <div className="flex items-center space-x-2 mb-1 px-1 text-[11px] text-[#8A8A8A]">
                <span className={`font-semibold ${isAgent ? 'text-[#7CFF00]' : 'text-[#FFFFFF]'}`}>
                  {isAgent ? 'Sarah Lin' : customer?.name}
                </span>
                <span>·</span>
                <span className="font-mono text-[10px]">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {/* Message Bubble */}
              <div
                className={`max-w-[75%] rounded-md px-4 py-2.5 text-xs leading-relaxed ${
                  isAgent
                    ? 'bg-[#161616] border border-[#7CFF00]/40 text-[#FFFFFF] shadow-sm'
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

      {/* Fixed Message Composer at bottom */}
      <form onSubmit={handleSend} className="p-3 bg-[#0E0E0E] border-t border-[#222222] flex items-center space-x-2 shrink-0">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={`Reply to ${customer?.name || 'customer'}...`}
          className="flex-1 bg-[#161616] border border-[#222222] focus:border-[#7CFF00] rounded px-3.5 py-2 text-xs text-[#FFFFFF] placeholder-[#8A8A8A] focus:outline-none transition-colors"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          className="px-4 py-2 rounded bg-[#7CFF00] hover:bg-[#8EFF1F] text-[#090909] text-xs font-bold flex items-center space-x-1.5 transition-all shadow-neon-sm disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <span>Send</span>
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}

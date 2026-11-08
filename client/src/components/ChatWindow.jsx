import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  ChevronDown, 
  ChevronUp, 
  Check, 
  UserCheck, 
  Bot,
  PanelRightClose,
  PanelRightOpen,
  Package
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
    <div className="flex flex-col h-full bg-[#191A19] overflow-hidden">
      {/* Workspace Header */}
      <div className="px-5 py-3 bg-[#111311] border-b border-[#353B35] flex items-center justify-between shrink-0">
        {/* Customer & Order Summary */}
        <div className="flex items-center space-x-3">
          <img
            src={customer?.avatar}
            alt={customer?.name}
            className="w-8 h-8 rounded-full object-cover border border-[#353B35] grayscale"
          />
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-xs text-[#D5D9D3]">{customer?.name}</span>
              <span className="text-[11px] text-[#929A91] font-mono">({ticket?.orderId})</span>
              
              {/* Minimal Status Indicator */}
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${
                isHandoffRequested
                  ? 'border-[#5C1721] bg-[#2A1316] text-[#A51F32]'
                  : isResolved
                  ? 'border-[#235D43] bg-[#142E22] text-[#D5D9D3]'
                  : isAgentActive
                  ? 'border-[#353B35] bg-[#242724] text-[#D5D9D3]'
                  : 'border-[#353B35] text-[#929A91]'
              }`}>
                {currentStatus}
              </span>
            </div>

            <div className="flex items-center space-x-2 text-[11px] text-[#929A91] mt-0.5">
              <span>{order?.product}</span>
              <span>·</span>
              <button
                onClick={() => setShowOrderDetails(!showOrderDetails)}
                className="text-[#929A91] hover:text-[#D5D9D3] underline flex items-center space-x-0.5 transition-colors"
              >
                <span>{showOrderDetails ? 'Hide details' : 'Order details'}</span>
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
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#174B35] hover:bg-[#1F6246] text-[#D5D9D3] transition-colors"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Take Over</span>
            </button>
          )}

          {/* Mark Resolved Action */}
          {!isResolved ? (
            <button
              onClick={() => onUpdateStatus('Resolved')}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded text-xs text-[#929A91] hover:text-[#D5D9D3] bg-[#242724] hover:bg-[#2E332E] border border-[#353B35] transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Resolve</span>
            </button>
          ) : (
            <span className="text-xs text-[#929A91] px-2 py-1 bg-[#242724] rounded border border-[#353B35]">
              Resolved
            </span>
          )}

          {/* Toggle AI Copilot Panel */}
          <button
            onClick={onToggleCopilot}
            className={`p-1.5 rounded text-[#929A91] hover:text-[#D5D9D3] border border-[#353B35] transition-colors ${
              isCopilotOpen ? 'bg-[#242724]' : 'bg-[#191A19]'
            }`}
            title={isCopilotOpen ? 'Collapse AI Copilot' : 'Expand AI Copilot'}
          >
            {isCopilotOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Collapsible Order Information Banner */}
      {showOrderDetails && order && (
        <div className="px-5 py-3 bg-[#111311] border-b border-[#353B35] text-xs text-[#929A91] grid grid-cols-2 md:grid-cols-4 gap-4 animate-fadeIn">
          <div>
            <span className="block text-[10px] uppercase font-semibold text-[#687267]">Item Ordered</span>
            <span className="text-[#D5D9D3] font-medium">{order.product}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase font-semibold text-[#687267]">Delivery Status</span>
            <span className="text-[#D5D9D3] font-medium">{order.status}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase font-semibold text-[#687267]">Carrier & Tracking</span>
            <span className="text-[#D5D9D3] font-mono">{order.carrier} · {order.trackingNumber}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase font-semibold text-[#687267]">Order Date & Price</span>
            <span className="text-[#D5D9D3]">{order.purchaseDate} (${order.price.toFixed(2)})</span>
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
                <div className="px-3 py-1 rounded bg-[#242724] border border-[#353B35] text-[11px] text-[#929A91]">
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
              <div className="flex items-center space-x-2 mb-1 px-1 text-[11px] text-[#929A91]">
                <span className="font-medium text-[#D5D9D3]">
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

      {/* Fixed Message Composer at bottom */}
      <form onSubmit={handleSend} className="p-3 bg-[#111311] border-t border-[#353B35] flex items-center space-x-2 shrink-0">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={`Reply to ${customer?.name || 'customer'}...`}
          className="flex-1 bg-[#191A19] border border-[#353B35] focus:border-[#174B35] rounded px-3.5 py-2 text-xs text-[#D5D9D3] placeholder-[#929A91] focus:outline-none transition-colors"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          className="px-4 py-2 rounded bg-[#174B35] hover:bg-[#1F6246] text-[#D5D9D3] text-xs font-medium flex items-center space-x-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <span>Send</span>
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}

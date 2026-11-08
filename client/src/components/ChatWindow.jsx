import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  ChevronDown, 
  ChevronUp, 
  Check, 
  UserCheck, 
  Sparkles,
  Inbox
} from 'lucide-react';

export default function ChatWindow({
  ticket,
  messages,
  onSendMessage,
  onUpdateStatus,
  isCopilotOpen,
  onToggleCopilot,
  isSplitView = false,
  isInboxOpen = false,
  onToggleInbox,
  inboxCount = 3,
}) {
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showOrderDetails, setShowOrderDetails] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!inputText.trim() || isSending) return;
    const textToSend = inputText.trim();
    setInputText('');
    setIsSending(true);
    try {
      await onSendMessage(textToSend);
    } finally {
      setIsSending(false);
    }
  };

  const customer = ticket?.customer;
  const order = customer?.order;

  // Canonical status mapping
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
    <div className="flex-1 h-full min-w-0 flex flex-col bg-[#090909] overflow-hidden">
      {/* Workspace Header: Clean, Uncluttered, Single Row */}
      <div className="px-6 py-4 bg-[#0D0D0D] border-b border-[#1A1A1A] flex items-center justify-between shrink-0 gap-4">
        {/* Customer & Order Summary */}
        <div className="flex items-center space-x-3.5 min-w-0">
          <img
            src={customer?.avatar}
            alt={customer?.name}
            className="w-9 h-9 rounded-full object-cover border border-[#282828] grayscale shrink-0"
          />
          <div className="min-w-0">
            <div className="flex items-center space-x-2.5">
              <span className="font-bold text-base text-[#FFFFFF] truncate">{customer?.name}</span>
              <span className="text-xs text-[#8A8A8A] font-mono shrink-0">({ticket?.orderId})</span>
              
              {/* Single Prominent Status Indicator (Suppressed when resolved to prevent duplicate labels) */}
              {!isResolved && (
                <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border shrink-0 ${
                  isHandoffRequested
                    ? 'border-[#5C151F] bg-[#250C10] text-[#FF334B]'
                    : isAgentActive
                    ? 'border-[#282828] bg-[#161616] text-[#FFFFFF]'
                    : 'border-[#222222] text-[#8A8A8A]'
                }`}>
                  {currentStatus}
                </span>
              )}
            </div>

            <div className="flex items-center space-x-2 text-xs text-[#8A8A8A] mt-0.5">
              <span className="truncate">{order?.product}</span>
              <span>·</span>
              <button
                onClick={() => setShowOrderDetails(!showOrderDetails)}
                className="text-[#8A8A8A] hover:text-[#FFFFFF] underline flex items-center space-x-0.5 shrink-0 transition-colors text-xs"
              >
                <span>{showOrderDetails ? 'Hide order details' : 'Order details'}</span>
                {showOrderDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Action Controls: Inbox Toggle (Split View) / Take Over / Resolve / Toggle Copilot */}
        <div className="flex items-center space-x-2 shrink-0">
          {/* Split View Compact Inbox Toggle Button */}
          {isSplitView && onToggleInbox && (
            <button
              id="btn-toggle-inbox"
              onClick={onToggleInbox}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                isInboxOpen
                  ? 'bg-[#1E1E1E] text-[#7CFF00] border border-[#7CFF00]/40'
                  : 'bg-[#141414] text-[#8A8A8A] hover:text-[#FFFFFF] border border-[#222222] hover:border-[#7CFF00]/40'
              }`}
              title={isInboxOpen ? "Close Inbox" : "Open Inbox"}
            >
              <Inbox className="w-3.5 h-3.5 text-[#7CFF00]" />
              <span className="hidden sm:inline">Inbox</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 bg-[#7CFF00]/10 text-[#7CFF00] rounded font-bold">
                {inboxCount}
              </span>
            </button>
          )}
          {/* Take Over Button when human requested */}
          {isHandoffRequested && (
            <button
              id="btn-takeover-ticket"
              onClick={() => onUpdateStatus('Human Agent Active')}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-[#7CFF00] hover:bg-[#8EFF1F] text-[#090909] transition-all shadow-neon-sm"
            >
              <UserCheck className="w-4 h-4" />
              <span>Take Over</span>
            </button>
          )}

          {/* Mark Resolved Action */}
          {!isResolved ? (
            <button
              id="btn-resolve-ticket"
              onClick={() => onUpdateStatus('Resolved')}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-[#8A8A8A] hover:text-[#FFFFFF] bg-[#141414] hover:bg-[#1E1E1E] border border-[#222222] hover:border-[#7CFF00]/40 transition-colors"
            >
              <Check className="w-3.5 h-3.5 text-[#7CFF00]" />
              <span>Resolve</span>
            </button>
          ) : (
            <button
              id="btn-reopen-ticket"
              onClick={() => onUpdateStatus('Human Agent Active')}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-[#7CFF00]/10 hover:bg-[#7CFF00]/20 rounded-xl border border-[#7CFF00]/40 text-xs transition-colors"
              title="Ticket resolved. Click to reopen."
            >
              <Check className="w-3.5 h-3.5 text-[#7CFF00]" />
              <span className="text-[#7CFF00] font-semibold">Resolved</span>
              <span className="text-[10px] text-[#8A8A8A] hidden sm:inline">(Reopen)</span>
            </button>
          )}

          {/* Prominent AI Copilot Drawer Toggle */}
          <button
            id="btn-toggle-copilot"
            onClick={onToggleCopilot}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              isCopilotOpen
                ? 'bg-[#7CFF00] text-[#090909] shadow-neon-sm font-bold'
                : 'bg-[#141414] text-[#FFFFFF] border border-[#222222] hover:border-[#7CFF00]/50 hover:text-[#7CFF00]'
            }`}
            title={isCopilotOpen ? 'Close AI Copilot' : 'Open AI Copilot'}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Copilot</span>
          </button>
        </div>
      </div>

      {/* Collapsible Order Information Banner */}
      {showOrderDetails && order && (
        <div className="px-6 py-3.5 bg-[#0D0D0D] border-b border-[#1A1A1A] text-xs text-[#8A8A8A] grid grid-cols-2 md:grid-cols-4 gap-4 animate-fadeIn shrink-0">
          <div>
            <span className="block text-[10px] uppercase font-bold text-[#555555]">Item Ordered</span>
            <span className="text-[#FFFFFF] font-medium truncate block mt-0.5">{order.product}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase font-bold text-[#555555]">Delivery Status</span>
            <span className="text-[#7CFF00] font-medium mt-0.5 block">{order.status}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase font-bold text-[#555555]">Carrier & Tracking</span>
            <span className="text-[#FFFFFF] font-mono truncate block mt-0.5">{order.carrier} · {order.trackingNumber}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase font-bold text-[#555555]">Order Date & Price</span>
            <span className="text-[#FFFFFF] mt-0.5 block">{order.purchaseDate} (${order.price.toFixed(2)})</span>
          </div>
        </div>
      )}

      {/* Messages Stream - Generous readable spacing with natural line length and 15px typography */}
      <div className="flex-1 overflow-y-auto px-6 md:px-8 py-6 space-y-6 bg-[#090909]">
        {messages.map((msg) => {
          const isAgent = msg.senderRole === 'agent' || msg.senderId === 'agent_sarah';
          const isSystem = msg.senderRole === 'system';

          if (isSystem) {
            return (
              <div key={msg.id} className="flex justify-center my-3">
                <div className="px-4 py-1.5 rounded-full bg-[#141414] border border-[#222222] text-xs text-[#8A8A8A]">
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
              <div className="flex items-center space-x-2 mb-1.5 px-1 text-xs text-[#8A8A8A]">
                <span className={`font-semibold ${isAgent ? 'text-[#7CFF00]' : 'text-[#FFFFFF]'}`}>
                  {isAgent ? 'Sarah Lin' : customer?.name}
                </span>
                <span>·</span>
                <span className="font-mono text-[11px]">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {/* Message Bubble: Natural max-width, comfortable padding, 15px text */}
              <div
                className={`max-w-[72%] rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed ${
                  isAgent
                    ? 'bg-[#181818] border border-[#2A2A2A] text-[#FFFFFF]'
                    : 'bg-[#121212] border border-[#222222] text-[#EAEAEA]'
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.text}</p>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Fixed Composer at bottom - Elevated z-40 so it is never obscured by overlay drawers */}
      <form onSubmit={handleSend} className="p-4 bg-[#0D0D0D] border-t border-[#1A1A1A] flex items-center space-x-3 shrink-0 relative z-40">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={`Reply to ${customer?.name || 'customer'}...`}
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
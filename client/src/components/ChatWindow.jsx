import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  ChevronDown,
  ChevronUp,
  Check,
  UserCheck,
  Sparkles,
  Inbox,
  Globe,
  X,
  Image as ImageIcon,
  ArrowDownToLine,
  Loader2,
  AlertTriangle,
  Lock,
  ArrowRightLeft,
  UserPlus
} from 'lucide-react';
import { translateText } from '../services/api';

export default function ChatWindow({
  ticket,
  messages,
  onSendMessage,
  onUpdateStatus,
  onTransferTicket = null,
  onClaimTicket = null,
  agentRoster = [],
  currentAgentId = 'user_sarah_lin',
  isCopilotOpen,
  onToggleCopilot,
  isSplitView = false,
  isInboxOpen = false,
  onToggleInbox,
  inboxCount = 3,
}) {
  const [inputText, setInputText] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showOrderDetails, setShowOrderDetails] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [translationsMap, setTranslationsMap] = useState({});
  const [translatingIds, setTranslatingIds] = useState(new Set());
  const [downloadingAttId, setDownloadingAttId] = useState(null);
  const [downloadError, setDownloadError] = useState({});

  // Transfer modal state
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [targetAgentId, setTargetAgentId] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [transferInternalNotes, setTransferInternalNotes] = useState('');
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferError, setTransferError] = useState(null);

  const messagesEndRef = useRef(null);

  const handleDownloadAttachment = async (att) => {
    const attKey = att.id || att.name || 'attachment';
    try {
      setDownloadingAttId(attKey);
      setDownloadError((prev) => ({ ...prev, [attKey]: null }));

      // 1. If attachment has an ID, request authorized server download endpoint
      if (att.id) {
        const res = await fetch(`/api/attachments/${encodeURIComponent(att.id)}/download`, {
          method: 'GET',
          headers: {
            'X-Agent-Id': 'user_sarah_lin',
            'X-Brand-Id': 'brand_novacart'
          },
          credentials: 'include'
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Download failed with HTTP ${res.status}`);
        }

        const blob = await res.blob();
        const objectUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = att.name || 'attachment.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(objectUrl);
        return;
      }

      // 2. Fallback: if att.dataUrl exists and no server ID
      if (att.dataUrl) {
        const link = document.createElement('a');
        link.href = att.dataUrl;
        link.download = att.name || 'attachment.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }

      throw new Error('No attachment data available for download.');
    } catch (err) {
      console.error('[Attachment Download Failed]:', err);
      setDownloadError((prev) => ({ ...prev, [attKey]: err.message || 'Download failed' }));
      setTimeout(() => {
        setDownloadError((prev) => ({ ...prev, [attKey]: null }));
      }, 4000);
    } finally {
      setDownloadingAttId(null);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!inputText.trim() || isSending) return;
    const textToSend = inputText.trim();
    const wasInternal = isInternalNote;
    setInputText('');
    setIsInternalNote(false);
    setIsSending(true);
    try {
      await onSendMessage(textToSend, { isInternal: wasInternal });
    } finally {
      setIsSending(false);
    }
  };

  const handleTransferSubmit = async (e) => {
    e?.preventDefault();
    if (!targetAgentId) {
      setTransferError('Please select a target agent');
      return;
    }
    if (!transferReason.trim()) {
      setTransferError('Please provide a handoff reason');
      return;
    }

    setIsTransferring(true);
    setTransferError(null);
    try {
      if (onTransferTicket) {
        await onTransferTicket(ticket.id, {
          toAgentId: targetAgentId,
          handoffSummaryJson: {
            reason: transferReason.trim(),
            customerContext: `${customer?.name || 'Customer'} (${ticket.orderId})`,
            transferredAt: new Date().toISOString()
          },
          internalNotes: transferInternalNotes.trim()
        });
        setShowTransferModal(false);
        setTargetAgentId('');
        setTransferReason('');
        setTransferInternalNotes('');
      }
    } catch (err) {
      setTransferError(err.message || 'Transfer failed');
    } finally {
      setIsTransferring(false);
    }
  };

  const handleTranslateMessage = async (msgId, text, langHint) => {
    if (translationsMap[msgId]?.translated || translatingIds.has(msgId)) return;
    setTranslatingIds((prev) => new Set(prev).add(msgId));
    try {
      const srcLocale = langHint === 'hi' ? 'hi-IN' : langHint === 'mr' ? 'mr-IN' : 'auto';
      const res = await translateText({
        brandId: ticket?.brandId || 'brand_novacart',
        ticketId: ticket?.id,
        messageId: msgId,
        text,
        targetLanguage: 'en-US',
        sourceLanguage: srcLocale,
      });

      if (res?.translated && res?.translatedText && res.translatedText !== text) {
        setTranslationsMap((prev) => ({
          ...prev,
          [msgId]: {
            translated: true,
            translatedText: res.translatedText,
            originalText: text,
            sourceLang: res.sourceLocale || srcLocale,
            targetLang: res.targetLocale || 'en-US'
          },
        }));
      } else if (res?.circuitBreakerOpen || res?.error || res?.translated === false) {
        setTranslationsMap((prev) => ({
          ...prev,
          [msgId]: {
            translated: false,
            translatedText: text,
            originalText: text,
            unavailable: true,
            error: res?.error || 'Translation service is temporarily unavailable',
            sourceLang: srcLocale,
            targetLang: 'en-US'
          },
        }));
      } else if (res?.translatedText) {
        // Fallback response with translation
        setTranslationsMap((prev) => ({
          ...prev,
          [msgId]: {
            translated: true,
            translatedText: res.translatedText,
            originalText: text,
            sourceLang: srcLocale,
            targetLang: 'en-US'
          },
        }));
      }
    } catch (err) {
      console.warn('Translation error:', err);
      setTranslationsMap((prev) => ({
        ...prev,
        [msgId]: {
          translated: false,
          translatedText: text,
          originalText: text,
          unavailable: true,
          error: err.message || 'Translation unavailable',
          sourceLang: langHint || 'auto',
          targetLang: 'en-US'
        },
      }));
    } finally {
      setTranslatingIds((prev) => {
        const next = new Set(prev);
        next.delete(msgId);
        return next;
      });
    }
  };

  const customer = ticket?.customer;
  const order = customer?.order;

  // Detect if customer uses a non-English language (e.g. Hindi or Marathi)
  const isDevanagari = (text) => /[\u0900-\u097F]/.test(text || '');
  const detectedLang = messages.find(m => m.metadata?.language && m.metadata?.language !== 'en')?.metadata?.language
    || (messages.some(m => isDevanagari(m.text)) ? 'hi' : null);

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
    <div className="flex-1 h-full min-w-0 flex flex-col bg-[#090909] overflow-hidden relative">
      {/* Workspace Header: Clean, Uncluttered, Single Row */}
      <div className="px-6 py-4 bg-[#0D0D0D] border-b border-[#1A1A1A] flex items-center justify-between shrink-0 gap-4">
        {/* Customer & Order Summary (with Left-aligned Inbox Toggle for Split View) */}
        <div className="flex items-center space-x-3.5 min-w-0">
          {/* Split View Compact Inbox Toggle Button on the Left */}
          {isSplitView && onToggleInbox && (
            <button
              id="btn-toggle-inbox"
              onClick={onToggleInbox}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all shrink-0 ${
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

          <img
            src={customer?.avatar}
            alt={customer?.name}
            className="w-9 h-9 rounded-full object-cover border border-[#282828] grayscale shrink-0"
          />
          <div className="min-w-0">
            <div className="flex items-center space-x-2.5">
              <span className="font-bold text-base text-[#FFFFFF] truncate">{customer?.name}</span>
              <span className="text-xs text-[#8A8A8A] font-mono shrink-0">({ticket?.orderId})</span>

              {/* Single Prominent Status Indicator */}
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

              {/* Language Indicator Badge if Customer is using non-English */}
              {detectedLang && (
                <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#121E28] border border-[#1E3A5F] text-[#60A5FA] shrink-0">
                  <Globe className="w-3 h-3" />
                  <span>{detectedLang === 'hi' ? 'Hindi' : detectedLang === 'mr' ? 'Marathi' : detectedLang.toUpperCase()}</span>
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

        {/* Action Controls: Take Over / Resolve / Toggle Copilot */}
        <div className="flex items-center space-x-2 shrink-0">
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

          {/* Claim Ticket button if unassigned */}
          {(!ticket?.assignedAgentId && !ticket?.assigned_agent_id) && onClaimTicket && (
            <button
              onClick={() => onClaimTicket(ticket.id)}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#7CFF00] hover:bg-[#8EFF1F] text-[#090909] transition-all shadow-neon-sm"
              title="Claim this unassigned ticket"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Claim</span>
            </button>
          )}

          {/* Transfer Button if ticket is active and not resolved */}
          {!isResolved && onTransferTicket && (
            <button
              onClick={() => setShowTransferModal(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-[#8A8A8A] hover:text-[#FFFFFF] bg-[#141414] hover:bg-[#1E1E1E] border border-[#222222] hover:border-[#38BDF8]/40 transition-colors"
              title="Transfer ticket to another agent"
            >
              <ArrowRightLeft className="w-3.5 h-3.5 text-[#38BDF8]" />
              <span className="hidden sm:inline">Transfer</span>
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
            <span className="text-[#FFFFFF] mt-0.5 block">{order.purchaseDate} (${order.price?.toFixed(2) || '0.00'})</span>
          </div>
        </div>
      )}

      {/* Customer Resolution Feedback Bar (Compact, Dedicated Non-Overlapping Section) */}
      {ticket?.feedback && (
        <div className="px-6 py-2.5 bg-[#0C150A] border-b border-[#7CFF00]/25 text-xs flex items-center justify-between shrink-0 animate-fadeIn">
          <div className="flex items-center space-x-2.5 min-w-0">
            <span className="text-[#7CFF00] font-bold shrink-0">Customer Feedback:</span>
            <span className="text-[#FFFFFF] font-semibold shrink-0">
              {'⭐'.repeat(Number(ticket.feedback.rating) || 5)} ({ticket.feedback.rating || 5}/5)
            </span>
            {ticket.feedback.comment ? (
              <span className="text-[#BBBBBB] italic truncate max-w-sm">
                "{ticket.feedback.comment}"
              </span>
            ) : null}
          </div>
          <div className="flex items-center space-x-2.5 shrink-0">
            {ticket.feedback.submittedAt && (
              <span className="text-[10px] text-[#777777] font-mono">
                {new Date(ticket.feedback.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-[#7CFF00]/10 text-[#7CFF00] font-bold border border-[#7CFF00]/30">
              {ticket.feedback.resolved ? 'Resolved' : 'Needs Followup'}
            </span>
          </div>
        </div>
      )}

      {/* Messages Stream - Generous readable spacing with natural line length and 15px typography */}
      <div className="flex-1 overflow-y-auto px-6 md:px-8 py-6 space-y-6 bg-[#090909]">
        {messages.map((msg) => {
          const isAgent = msg.senderRole === 'agent' || msg.senderId === 'agent_sarah';
          const isSystem = msg.senderRole === 'system';
          const att = msg.attachment || msg.metadata?.attachment;
          const msgLang = msg.metadata?.language;
          const hasDevanagari = isDevanagari(msg.text);
          const needsTranslation = !isAgent && !isSystem && (msgLang === 'hi' || msgLang === 'mr' || hasDevanagari);
          const rawTrans = translationsMap[msg.id];
          const transInfo = typeof rawTrans === 'object' && rawTrans !== null
            ? rawTrans
            : (rawTrans ? { translated: true, translatedText: rawTrans, sourceLang: msgLang, targetLang: 'en-US' } : null);
          const isTranslated = Boolean(transInfo?.translated || msg.metadata?.translatedText);
          const finalTranslatedText = transInfo?.translatedText || (typeof rawTrans === 'string' ? rawTrans : null) || msg.metadata?.translatedText;
          const isUnavailable = Boolean(transInfo?.unavailable);
          const isTranslating = translatingIds.has(msg.id);

          const isInternal = Boolean(
            msg.isInternal ||
            msg.metadata?.isInternal ||
            msg.senderRole === 'internal_note' ||
            msg.metadata?.type === 'INTERNAL_NOTE' ||
            msg.metadata?.type === 'TRANSFER_HANDOFF' ||
            msg.messageType === 'internal_note'
          );

          if (isInternal) {
            return (
              <div key={msg.id} className="w-full flex justify-center my-3 animate-fadeIn">
                <div className="w-full max-w-[85%] rounded-xl p-3.5 bg-[#1B150A] border border-[#F59E0B]/40 text-xs text-[#FDE68A] space-y-2 shadow-md">
                  <div className="flex items-center justify-between text-[11px] font-bold text-[#F59E0B]">
                    <div className="flex items-center space-x-1.5">
                      <Lock className="w-3.5 h-3.5 text-[#F59E0B]" />
                      <span>{msg.metadata?.type === 'TRANSFER_HANDOFF' ? 'Ticket Transfer & Handoff Summary' : 'Private Team Note'}</span>
                    </div>
                    <span className="text-[10px] bg-[#F59E0B]/10 text-[#F59E0B] px-2 py-0.5 rounded font-mono border border-[#F59E0B]/30">
                      Team Only • Private
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-[#FEF3C7] text-xs leading-relaxed font-sans">{msg.text}</p>
                  {msg.metadata?.handoffSummary && (
                    <div className="mt-1 pt-1.5 border-t border-[#F59E0B]/20 text-[11px] text-[#FBBF24] space-y-0.5">
                      <span className="font-semibold block text-[#F59E0B]">Transfer Context:</span>
                      <p className="text-[#FDE68A] italic">
                        {typeof msg.metadata.handoffSummary === 'string' ? msg.metadata.handoffSummary : JSON.stringify(msg.metadata.handoffSummary)}
                      </p>
                    </div>
                  )}
                  <div className="text-[10px] text-[#D97706] flex items-center justify-between pt-1 border-t border-[#F59E0B]/10">
                    <span>Author: <strong>{msg.senderName || 'Agent'}</strong></span>
                    <span>{new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              </div>
            );
          }

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
                {needsTranslation && (
                  <span className="text-[10px] text-[#60A5FA] font-medium bg-[#121E28] px-1.5 py-0.2 rounded">
                    {msgLang === 'hi' ? 'Hindi' : msgLang === 'mr' ? 'Marathi' : 'Devanagari'}
                  </span>
                )}
              </div>

              {/* Message Bubble */}
              <div
                className={`max-w-[72%] rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed ${
                  isAgent
                    ? 'bg-[#181818] border border-[#2A2A2A] text-[#FFFFFF]'
                    : 'bg-[#121212] border border-[#222222] text-[#EAEAEA]'
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.text}</p>

                {/* Image Attachment Rendering */}
                {att && (att.dataUrl || att.id) && (
                  <div className="mt-3 pt-2.5 border-t border-[#222222] space-y-2">
                    {att.dataUrl && (
                      <div
                        onClick={() => setLightboxImage(att.dataUrl)}
                        className="cursor-pointer group relative overflow-hidden rounded-xl border border-[#2A2A2A] max-w-[280px] bg-[#0A0A0A] hover:border-[#7CFF00]/50 transition-colors"
                      >
                        <img
                          src={att.dataUrl}
                          alt={att.name || 'Attachment'}
                          className="max-h-52 w-full object-cover group-hover:scale-105 transition-transform duration-200"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs text-white font-medium">
                          Click to view full photo
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[11px] text-[#8A8A8A] max-w-[280px] gap-2">
                      <div className="flex items-center space-x-1.5 min-w-0 truncate">
                        <ImageIcon className="w-3.5 h-3.5 text-[#7CFF00] shrink-0" />
                        <span className="truncate text-[#CCCCCC]" title={att.name}>{att.name}</span>
                        {att.size && <span className="text-[10px] text-[#777777] shrink-0">({Math.round(att.size / 1024)} KB)</span>}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadAttachment(att);
                        }}
                        disabled={downloadingAttId === (att.id || att.name)}
                        className="inline-flex items-center space-x-1 px-2 py-1 rounded bg-[#181818] hover:bg-[#222222] border border-[#2E2E2E] hover:border-[#7CFF00]/50 text-[#7CFF00] text-[10px] font-semibold transition-all shadow-sm shrink-0 disabled:opacity-50"
                        title={`Download ${att.name || 'attachment'}`}
                        aria-label={`Download ${att.name || 'attachment'}`}
                      >
                        {downloadingAttId === (att.id || att.name) ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin text-[#7CFF00]" />
                            <span className="font-mono">Saving...</span>
                          </>
                        ) : (
                          <>
                            <ArrowDownToLine className="w-3 h-3 text-[#7CFF00]" />
                            <span>Download</span>
                          </>
                        )}
                      </button>
                    </div>
                    {downloadError[att.id || att.name] && (
                      <div className="text-[10px] text-[#FF4D4D] bg-[#2A0808] px-2 py-0.5 rounded border border-[#551010] animate-fadeIn">
                        {downloadError[att.id || att.name]}
                      </div>
                    )}
                  </div>
                )}

                {/* Multilingual Translation Translation Box for Agent */}
                {needsTranslation && (
                  <div className="mt-2.5 pt-2 border-t border-[#262626] text-xs">
                    {isTranslated && finalTranslatedText ? (
                      <div className="space-y-1.5 bg-[#161616] p-2.5 rounded-lg border border-[#242424]">
                        <div className="flex items-center justify-between text-[10px] text-[#7CFF00] font-semibold">
                          <div className="flex items-center space-x-1.5">
                            <Globe className="w-3 h-3" />
                            <span>Translated ({transInfo?.sourceLang || msgLang || 'Original'} → {transInfo?.targetLang || 'English'}):</span>
                          </div>
                          <span className="text-[9px] bg-[#1E2E1E] text-[#7CFF00] px-1.5 py-0.5 rounded font-mono">
                            Translated
                          </span>
                        </div>
                        <p className="text-[#E0E0E0] text-xs leading-relaxed font-sans">
                          "{finalTranslatedText}"
                        </p>
                        <details className="text-[10px] text-[#8A8A8A] mt-1 cursor-pointer">
                          <summary className="hover:text-[#CCCCCC] select-none">View original message</summary>
                          <p className="mt-1 p-1.5 bg-[#111111] rounded border border-[#222222] text-[#AAAAAA] italic">
                            "{msg.text}"
                          </p>
                        </details>
                      </div>
                    ) : isUnavailable ? (
                      <div className="space-y-1 bg-[#221A0E] p-2 rounded-lg border border-[#443315] text-[11px] text-[#FBBF24]">
                        <div className="flex items-center space-x-1.5 font-medium">
                          <AlertTriangle className="w-3.5 h-3.5 text-[#FBBF24] shrink-0" />
                          <span>Translation unavailable: viewing original message</span>
                        </div>
                        <p className="text-[10px] text-[#D97706] pl-5">
                          {transInfo.error || 'Circuit breaker is OPEN. English bridge paused.'}
                        </p>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleTranslateMessage(msg.id, msg.text, msgLang)}
                        disabled={isTranslating}
                        className="text-[11px] text-[#60A5FA] hover:text-[#93C5FD] underline flex items-center space-x-1 transition-colors"
                      >
                        <Globe className="w-3 h-3" />
                        <span>{isTranslating ? 'Translating...' : 'Translate to English'}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Fixed Composer at bottom - Elevated z-40 so it is never obscured by overlay drawers */}
      <form onSubmit={handleSend} className="p-4 bg-[#0D0D0D] border-t border-[#1A1A1A] flex items-center space-x-3 shrink-0 relative z-40">
        <button
          type="button"
          onClick={() => setIsInternalNote(!isInternalNote)}
          className={`px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all shrink-0 ${
            isInternalNote
              ? 'bg-[#F59E0B] text-[#090909] font-bold shadow-neon-sm'
              : 'bg-[#141414] text-[#8A8A8A] hover:text-[#FFFFFF] border border-[#222222]'
          }`}
          title="Toggle internal team note (confidential, never sent to customer)"
        >
          <Lock className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{isInternalNote ? 'Internal Note' : 'Add Note'}</span>
        </button>

        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={
            isInternalNote
              ? 'Add a private note for the team (customer cannot see this)...'
              : `Reply to ${customer?.name || 'customer'}...`
          }
          disabled={isSending}
          className={`flex-1 bg-[#141414] rounded-xl px-4 py-2.5 text-sm text-[#FFFFFF] placeholder-[#666666] focus:outline-none transition-colors disabled:opacity-50 border ${
            isInternalNote
              ? 'border-[#F59E0B] focus:border-[#F59E0B]'
              : 'border-[#222222] focus:border-[#7CFF00]'
          }`}
        />

        <button
          type="submit"
          disabled={!inputText.trim() || isSending}
          className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all shadow-neon-sm disabled:opacity-40 disabled:cursor-not-allowed shrink-0 ${
            isInternalNote
              ? 'bg-[#F59E0B] hover:bg-[#FBBF24] text-[#090909]'
              : 'bg-[#7CFF00] hover:bg-[#8EFF1F] text-[#090909]'
          }`}
        >
          <span>{isSending ? 'Sending...' : isInternalNote ? 'Post Note' : 'Send'}</span>
          {isInternalNote ? <Lock className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
        </button>
      </form>

      {/* Transfer Modal Dialog */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#111827] border border-[#374151] rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#1F2937] pb-3">
              <div className="flex items-center space-x-2">
                <ArrowRightLeft className="w-4 h-4 text-[#38BDF8]" />
                <span className="font-bold text-sm text-[#FFFFFF]">Transfer Ticket #{ticket.orderId}</span>
              </div>
              <button onClick={() => setShowTransferModal(false)} className="text-[#9CA3AF] hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {transferError && (
              <div className="p-2.5 bg-[#450A0A] border border-[#991B1B] rounded-xl text-xs text-[#FCA5A5]">
                {transferError}
              </div>
            )}

            <form onSubmit={handleTransferSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-[#9CA3AF] mb-1">Target Agent</label>
                <select
                  required
                  value={targetAgentId}
                  onChange={(e) => setTargetAgentId(e.target.value)}
                  className="w-full bg-[#0B0F17] border border-[#1F2937] focus:border-[#38BDF8] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                >
                  <option value="">Select an agent from roster...</option>
                  {agentRoster
                    .filter(a => a.userId !== currentAgentId && a.configuredStatus !== 'Offline')
                    .map(agent => (
                      <option key={agent.userId} value={agent.userId}>
                        {agent.displayName} ({agent.configuredStatus} • Workload: {agent.activeTicketCount}/{agent.maxConcurrentTickets})
                      </option>
                    ))}
                  {agentRoster.length === 0 && (
                    <>
                      <option value="user_carlos">Carlos Gomez (Available • Specialist)</option>
                      <option value="user_elena">Elena Rostova (Available • Lead)</option>
                    </>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#9CA3AF] mb-1">Handoff Summary / Reason</label>
                <textarea
                  required
                  rows={3}
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  placeholder="Explain why this ticket is being transferred and customer situation..."
                  className="w-full bg-[#0B0F17] border border-[#1F2937] focus:border-[#38BDF8] rounded-xl p-2.5 text-xs text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#9CA3AF] mb-1">Internal Notes (Optional)</label>
                <input
                  type="text"
                  value={transferInternalNotes}
                  onChange={(e) => setTransferInternalNotes(e.target.value)}
                  placeholder="Private guidance for receiving agent..."
                  className="w-full bg-[#0B0F17] border border-[#1F2937] focus:border-[#38BDF8] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#1F2937]">
                <button
                  type="button"
                  onClick={() => setShowTransferModal(false)}
                  className="px-4 py-2 rounded-xl text-xs text-[#9CA3AF] hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isTransferring}
                  className="px-4 py-2 rounded-xl bg-[#38BDF8] hover:bg-[#60A5FA] text-[#090909] text-xs font-bold transition-all shadow-md disabled:opacity-50"
                >
                  {isTransferring ? 'Transferring...' : 'Confirm Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lightbox Modal for Photo Attachments */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-[#111111] rounded-2xl border border-[#2A2A2A] overflow-hidden p-2 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setLightboxImage(null)}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-black/70 text-white hover:bg-black/90 transition-colors z-10"
              title="Close Full Image"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={lightboxImage}
              alt="Full Resolution Attachment"
              className="max-h-[82vh] w-auto max-w-full rounded-xl object-contain mx-auto"
            />
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  X,
  Send,
  Paperclip,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ShieldCheck,
  User,
  PackageSearch,
  RotateCcw,
  AlertCircle,
  MessageCircleQuestion,
  Download,
  ArrowDownToLine,
  Loader2,
  Globe,
  ExternalLink,
  Minimize2,
  Maximize2,
  RefreshCw,
  CheckCircle2,
  Clock
} from 'lucide-react';
import { DEMO_CUSTOMERS } from '../data/demoData';
import { requestHumanAssistance, getTicket, updateTicket } from '../services/api';
import nexconnService from '../services/nexconnService';
import {
  TRANSLATIONS,
  SUPPORTED_LANGUAGES,
  getPersonalizedGreeting,
  getAssistantIntroMessage
} from '../utils/translations';

export default function EmbeddableWidget({
  brandId = 'brand_novacart',
  customer = null,
  onSelectCustomer = null,
  themeOverride = null,
  isOpen = false,
  onToggle = null,
  isStandalone = false, // When embedded in iframe
  prefillOrder = null
}) {
  // Theme and brand config
  const [brandConfig, setBrandConfig] = useState({
    name: 'NovaCart Support',
    tagline: 'Your Everyday Premium Marketplace',
    primaryColor: '#7CFF00',
    primaryTextColor: '#090909',
    accentColor: '#10B981',
    welcomeMessage: 'Hello! Welcome to NovaCart Support. How can we help you with your order today?'
  });

  // Active customer identity
  const [activeCustomer, setActiveCustomer] = useState(customer || DEMO_CUSTOMERS[0]);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [ticketStatus, setTicketStatus] = useState('AI Handling');
  const [humanRequested, setHumanRequested] = useState(false);
  const [showOrderDrawer, setShowOrderDrawer] = useState(false);
  const [currentLang, setCurrentLang] = useState('en');
  const [attachment, setAttachment] = useState(null);
  const [downloadingAttId, setDownloadingAttId] = useState(null);
  const [downloadError, setDownloadError] = useState({});
  const [isExpanded, setIsExpanded] = useState(false); // Expanded desktop view
  const [connectionStatus, setConnectionStatus] = useState('connecting');

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;

  // Merge theme overrides
  const effectiveTheme = {
    ...brandConfig,
    ...themeOverride
  };

  // Sync external customer prop
  useEffect(() => {
    if (customer && customer.id !== activeCustomer?.id) {
      setActiveCustomer(customer);
    }
  }, [customer]);

  // Load brand config from server API
  useEffect(() => {
    let isMounted = true;
    async function loadBrandConfig() {
      try {
        const res = await fetch(`/api/widget/config?brandId=${brandId}`);
        if (res.ok) {
          const data = await res.json();
          if (isMounted && data.success) {
            setBrandConfig({
              name: data.brand?.name || 'NovaCart Support',
              tagline: data.theme?.tagline || 'Your Everyday Premium Marketplace',
              primaryColor: data.theme?.primaryColor || '#7CFF00',
              primaryTextColor: data.theme?.primaryTextColor || '#090909',
              accentColor: data.theme?.accentColor || '#10B981',
              welcomeMessage: data.theme?.welcomeMessage || 'Hello! Welcome to NovaCart Support.'
            });
          }
        }
      } catch (e) {
        // Fallback default
      }
    }
    loadBrandConfig();
    return () => { isMounted = false; };
  }, [brandId]);

  // Connect to Nexconn & subscribe to channel
  useEffect(() => {
    if (!activeCustomer) return;

    const channelId = activeCustomer.channelId || `channel_${activeCustomer.order?.orderId || 'NC1021'}`;
    const ticketId = activeCustomer.ticket?.id || `tkt_${activeCustomer.order?.orderId || '1021'}`;

    setConnectionStatus('connecting');

    nexconnService.connectUser({
      userId: activeCustomer.id,
      userName: activeCustomer.name,
      channelId,
      role: 'customer'
    }).then(() => {
      setConnectionStatus(nexconnService.isConnected() ? 'connected' : 'ready');
    }).catch(() => {
      setConnectionStatus('ready');
    });

    // Check status
    const initialStatus = nexconnService.getTicketStatus(ticketId);
    setTicketStatus(initialStatus.status);
    setHumanRequested(initialStatus.humanRequested);

    // Initial message history
    const history = nexconnService.getChannelHistory(channelId);
    setMessages(history);

    // Channel subscriber
    const unsubscribe = nexconnService.subscribe(channelId, (incoming) => {
      setMessages(prev => {
        const msgId = incoming.id || incoming.messageId;
        if (prev.some(m => (m.id && m.id === msgId) || (m.messageId && m.messageId === msgId))) {
          return prev;
        }
        return [...prev, incoming];
      });

      const updated = nexconnService.getTicketStatus(ticketId);
      setTicketStatus(updated.status);
      setHumanRequested(updated.humanRequested);
    });

    return () => {
      unsubscribe();
    };
  }, [activeCustomer?.id]);

  // Scroll to bottom on message updates
  useEffect(() => {
    if (isOpen || isStandalone) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, isStandalone]);

  // Handle message send
  const handleSendMessage = async (textToSend = null) => {
    const raw = (textToSend !== null ? textToSend : inputText).trim();
    if (!raw && !attachment) return;

    const channelId = activeCustomer.channelId || `channel_${activeCustomer.order?.orderId || 'NC1021'}`;
    const ticketId = activeCustomer.ticket?.id || `tkt_${activeCustomer.order?.orderId || '1021'}`;

    setIsSending(true);
    setInputText('');

    try {
      const targetUserId = (ticketStatus === 'Human Agent Active' || humanRequested) ? 'agent_sarah' : 'novacart_support';
      await nexconnService.sendMessage({
        targetUserId,
        channelId,
        text: raw,
        attachment,
        metadata: {
          ticketId,
          orderId: activeCustomer.order?.orderId,
          language: currentLang,
          status: ticketStatus
        }
      });
      setAttachment(null);

      // Trigger AI reply if still AI Handling
      if (ticketStatus === 'AI Handling' && raw) {
        setTimeout(async () => {
          try {
            await nexconnService.triggerAIReply(
              channelId,
              raw,
              activeCustomer.order,
              ticketId,
              currentLang
            );
          } catch (e) {
            console.error('AI Reply error in widget:', e);
          }
        }, 600);
      }
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setIsSending(false);
    }
  };

  // Human handoff
  const handleRequestHuman = async () => {
    if (humanRequested) return;
    const ticketId = activeCustomer.ticket?.id || `tkt_${activeCustomer.order?.orderId || '1021'}`;
    const channelId = activeCustomer.channelId || `channel_${activeCustomer.order?.orderId || 'NC1021'}`;

    setHumanRequested(true);
    setTicketStatus('Human Requested');
    nexconnService.setTicketStatus(ticketId, 'Human Requested', true);

    await nexconnService.sendMessage({
      targetUserId: 'agent_sarah',
      channelId,
      text: t.systemHandoff || "Customer requested human agent assistance.",
      metadata: {
        role: 'system',
        isHandoff: true,
        ticketId
      }
    });

    try {
      await requestHumanAssistance(ticketId, activeCustomer.name, 'Customer requested human agent via widget');
    } catch (e) {
      // Offline fallback
    }
  };

  // Quick action triggers
  const handleSupportAction = (actionId) => {
    switch (actionId) {
      case 'track_order':
        handleSendMessage(t.quickTrackOrder || `Where is my order ${activeCustomer.order?.orderId}?`);
        break;
      case 'return_request':
        handleSendMessage(t.quickReturn || `I would like to initiate a return for order ${activeCustomer.order?.orderId}.`);
        break;
      case 'damaged_product':
        handleSendMessage(t.quickDamage || `I received the wrong/damaged item for order ${activeCustomer.order?.orderId}.`);
        break;
      case 'ask_question':
        handleSendMessage("Can you explain NovaCart's standard return and refund verification policy?");
        break;
      case 'connect_human':
        handleRequestHuman();
        break;
      default:
        break;
    }
  };

  // File upload handler with backend PostgreSQL BYTEA persistence
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert("Attachment exceeds 5MB size limit.");
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target.result;
      setAttachment({
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl,
        uploading: true
      });

      try {
        const ticketId = activeCustomer.ticket?.id || `tkt_${activeCustomer.order?.orderId || '1021'}`;
        const res = await fetch('/api/attachments/upload', {
          method: 'POST',
          headers: {
            'Content-Type': file.type,
            'X-File-Name': file.name,
            'X-Ticket-Id': ticketId,
            'X-Brand-Id': brandId,
            'X-Customer-Id': activeCustomer.id
          },
          body: file
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success && data.attachment) {
            setAttachment({
              id: data.attachment.id,
              name: file.name,
              type: file.type,
              size: file.size,
              dataUrl,
              downloadUrl: data.attachment.downloadUrl,
              uploading: false
            });
            return;
          }
        }
      } catch (uploadErr) {
        console.warn('[Widget attachment upload fallback to local preview]:', uploadErr.message);
      }

      setAttachment(prev => (prev ? { ...prev, uploading: false } : null));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Download attachment handler with session authorization
  const handleDownloadAttachment = async (att) => {
    const attKey = att.id || att.name || 'attachment';
    try {
      setDownloadingAttId(attKey);
      setDownloadError((prev) => ({ ...prev, [attKey]: null }));

      if (att.id) {
        const headers = {
          'X-Customer-Id': activeCustomer.id,
          'X-Brand-Id': brandId
        };
        if (sessionToken) {
          headers['Authorization'] = `Bearer ${sessionToken}`;
        }

        const res = await fetch(`/api/attachments/${encodeURIComponent(att.id)}/download`, {
          method: 'GET',
          headers,
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
      console.error('[Widget Download Failed]:', err);
      setDownloadError((prev) => ({ ...prev, [attKey]: err.message || 'Download failed' }));
      setTimeout(() => {
        setDownloadError((prev) => ({ ...prev, [attKey]: null }));
      }, 4000);
    } finally {
      setDownloadingAttId(null);
    }
  };

  // Transcript download
  const handleDownloadTranscript = () => {
    const content = messages.map(m => {
      const time = new Date(m.timestamp || Date.now()).toLocaleTimeString();
      const sender = m.senderRole === 'customer' ? activeCustomer.name : (m.senderRole === 'agent' ? 'Agent Sarah Lin' : 'NovaCart AI');
      return `[${time}] ${sender}: ${m.text || ''}`;
    }).join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NovaCart-Support-Transcript-${activeCustomer.order?.orderId || 'session'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // If closed and not standalone, show floating launcher button
  if (!isOpen && !isStandalone) {
    return (
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
        {/* Teaser pill banner */}
        <div
          onClick={onToggle}
          className="mb-2.5 px-3.5 py-1.5 rounded-full bg-[#121212] border border-[#222222] shadow-2xl flex items-center space-x-2 text-xs text-[#FFFFFF] hover:border-[#7CFF00]/50 transition-all cursor-pointer group animate-fade-in"
        >
          <span className="w-2 h-2 rounded-full bg-[#7CFF00] animate-pulse"></span>
          <span className="font-medium group-hover:text-[#7CFF00] transition-colors">
            {activeCustomer?.order ? `Order #${activeCustomer.order.orderId} help?` : 'Chat with NovaCart AI'}
          </span>
          <Sparkles className="w-3.5 h-3.5 text-[#7CFF00]" />
        </div>

        {/* Floating circular launcher */}
        <button
          onClick={onToggle}
          aria-label="Open NovaCart Support Chat"
          style={{ backgroundColor: effectiveTheme.primaryColor, color: effectiveTheme.primaryTextColor }}
          className="w-14 h-14 rounded-full flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition-all relative group"
        >
          <MessageSquare className="w-6 h-6 fill-current stroke-current" />
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#FF0055] rounded-full text-[10px] font-bold text-white flex items-center justify-center border-2 border-[#090909]">
            1
          </span>
        </button>
      </div>
    );
  }

  // Active Support Widget Container
  return (
    <div
      className={`flex flex-col bg-[#0C0C0C] text-[#FFFFFF] border border-[#222222] shadow-2xl transition-all duration-300 overflow-hidden ${
        isStandalone
          ? 'w-full h-full rounded-none'
          : `fixed bottom-6 right-6 z-50 rounded-2xl ${
              isExpanded
                ? 'w-[95vw] md:w-[680px] h-[85vh] max-h-[780px]'
                : 'w-[92vw] sm:w-[410px] h-[640px] max-h-[90vh]'
            }`
      }`}
    >
      {/* 1. Brand Header */}
      <div
        className="px-4 py-3 border-b border-[#1E1E1E] bg-[#121212] flex items-center justify-between shrink-0"
      >
        <div className="flex items-center space-x-3 min-w-0">
          <div
            style={{ backgroundColor: effectiveTheme.primaryColor, color: effectiveTheme.primaryTextColor }}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
          >
            <Sparkles className="w-5 h-5 fill-current" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center space-x-2">
              <span className="font-bold text-sm tracking-tight truncate text-[#FFFFFF]">
                {effectiveTheme.name}
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#7CFF00]/10 text-[#7CFF00] border border-[#7CFF00]/20 shrink-0">
                AI Active
              </span>
            </div>
            <span className="text-[11px] text-[#888888] truncate">
              {effectiveTheme.tagline}
            </span>
          </div>
        </div>

        {/* Top Header Actions */}
        <div className="flex items-center space-x-1 shrink-0">
          {/* Language Switcher */}
          <div className="relative group">
            <button
              className="p-1.5 rounded-lg hover:bg-[#1A1A1A] text-[#888888] hover:text-[#FFFFFF] transition-colors text-xs flex items-center space-x-1"
              title="Change language"
            >
              <Globe className="w-3.5 h-3.5" />
              <span className="uppercase font-semibold text-[11px]">{currentLang}</span>
            </button>
            <div className="absolute right-0 top-full mt-1 hidden group-hover:flex flex-col bg-[#1A1A1A] border border-[#2E2E2E] rounded-lg shadow-xl p-1 z-50 min-w-[90px]">
              {SUPPORTED_LANGUAGES.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => setCurrentLang(lang.code)}
                  className={`text-left px-2.5 py-1 text-xs rounded transition-colors ${
                    currentLang === lang.code ? 'bg-[#7CFF00] text-[#090909] font-bold' : 'text-[#CCCCCC] hover:bg-[#282828]'
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>

          {/* Transcript Download */}
          <button
            onClick={handleDownloadTranscript}
            className="p-1.5 rounded-lg hover:bg-[#1A1A1A] text-[#888888] hover:text-[#FFFFFF] transition-colors"
            title="Download Transcript"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          {/* Expand / Shrink */}
          {!isStandalone && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="hidden sm:flex p-1.5 rounded-lg hover:bg-[#1A1A1A] text-[#888888] hover:text-[#FFFFFF] transition-colors"
              title={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}

          {/* Close button */}
          {onToggle && !isStandalone && (
            <button
              onClick={onToggle}
              className="p-1.5 rounded-lg hover:bg-[#1A1A1A] text-[#888888] hover:text-[#FFFFFF] transition-colors"
              title="Minimize chat"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Customer Persona & Active Order Banner */}
      <div className="px-3.5 py-2.5 bg-[#141414] border-b border-[#1E1E1E] shrink-0">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2 truncate">
            <img
              src={activeCustomer?.avatar || DEMO_CUSTOMERS[0].avatar}
              alt={activeCustomer?.name}
              className="w-5 h-5 rounded-full border border-[#333333] shrink-0 object-cover"
            />
            <span className="font-semibold text-[#FFFFFF] truncate">
              {activeCustomer?.name}
            </span>
            <span className="text-[#666666]">•</span>
            <span className="text-[#AAAAAA] font-mono">
              #{activeCustomer?.order?.orderId}
            </span>
          </div>

          {/* Order Details Toggle */}
          <button
            onClick={() => setShowOrderDrawer(!showOrderDrawer)}
            className="flex items-center space-x-1 text-[11px] text-[#7CFF00] hover:underline shrink-0"
          >
            <span>{showOrderDrawer ? 'Hide Order' : 'View Order'}</span>
            {showOrderDrawer ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {/* Collapsible Order Drawer */}
        {showOrderDrawer && activeCustomer?.order && (
          <div className="mt-2.5 pt-2.5 border-t border-[#222222] bg-[#0E0E0E] p-2.5 rounded-lg border border-[#1A1A1A] text-xs space-y-1.5 animate-fade-in">
            <div className="flex items-center space-x-2.5">
              <img
                src={activeCustomer.order.image}
                alt={activeCustomer.order.product}
                className="w-10 h-10 rounded-md object-cover border border-[#222222] shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[#FFFFFF] truncate">{activeCustomer.order.product}</p>
                <p className="text-[11px] text-[#888888]">${activeCustomer.order.price.toFixed(2)} USD • {activeCustomer.order.carrier}</p>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                activeCustomer.order.status === 'Delayed'
                  ? 'bg-[#FF3366]/20 text-[#FF3366] border border-[#FF3366]/30'
                  : 'bg-[#7CFF00]/20 text-[#7CFF00] border border-[#7CFF00]/30'
              }`}>
                {activeCustomer.order.status}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#666666] pt-1">
              <span>Tracking: <code className="text-[#AAAAAA]">{activeCustomer.order.trackingNumber}</code></span>
              <span>{activeCustomer.order.deliveredDate ? `Delivered: ${activeCustomer.order.deliveredDate}` : `Est: ${activeCustomer.order.estimatedDelivery}`}</span>
            </div>
          </div>
        )}
      </div>

      {/* 3. Live Support Actions Pill Bar */}
      <div className="px-3 py-2 bg-[#0E0E0E] border-b border-[#1A1A1A] flex items-center space-x-1.5 overflow-x-auto no-scrollbar shrink-0">
        <button
          onClick={() => handleSupportAction('track_order')}
          className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-[#181818] hover:bg-[#222222] text-[#CCCCCC] hover:text-[#FFFFFF] text-[11px] font-medium border border-[#262626] transition-colors shrink-0"
        >
          <PackageSearch className="w-3 h-3 text-[#7CFF00]" />
          <span>Track Order</span>
        </button>

        <button
          onClick={() => handleSupportAction('return_request')}
          className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-[#181818] hover:bg-[#222222] text-[#CCCCCC] hover:text-[#FFFFFF] text-[11px] font-medium border border-[#262626] transition-colors shrink-0"
        >
          <RotateCcw className="w-3 h-3 text-[#38BDF8]" />
          <span>Return / Refund</span>
        </button>

        <button
          onClick={() => handleSupportAction('damaged_product')}
          className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-[#181818] hover:bg-[#222222] text-[#CCCCCC] hover:text-[#FFFFFF] text-[11px] font-medium border border-[#262626] transition-colors shrink-0"
        >
          <AlertCircle className="w-3 h-3 text-[#F59E0B]" />
          <span>Damaged / Wrong</span>
        </button>

        <button
          onClick={() => handleSupportAction('connect_human')}
          disabled={humanRequested || ticketStatus === 'Human Agent Active'}
          className={`flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors shrink-0 ${
            humanRequested || ticketStatus === 'Human Agent Active'
              ? 'bg-[#1E1E1E] text-[#666666] border-[#2A2A2A] cursor-not-allowed'
              : 'bg-[#181818] hover:bg-[#222222] text-[#CCCCCC] hover:text-[#FFFFFF] border-[#262626]'
          }`}
        >
          <User className="w-3 h-3 text-[#EC4899]" />
          <span>{humanRequested ? 'Agent Requested' : 'Talk to Agent'}</span>
        </button>
      </div>

      {/* 4. Chat Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-[#090909]">
        {/* Welcome greeting card */}
        <div className="bg-[#121212] border border-[#1E1E1E] rounded-xl p-3.5 text-xs text-[#CCCCCC] space-y-2">
          <div className="flex items-center space-x-2 text-[#7CFF00] font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            <span>{getPersonalizedGreeting(activeCustomer?.name || 'Customer', currentLang)}</span>
          </div>
          <p className="text-[11px] text-[#AAAAAA] leading-relaxed">
            {getAssistantIntroMessage(activeCustomer?.name || 'Customer', currentLang)}
          </p>
        </div>

        {/* Message Stream */}
        {messages.map((msg, index) => {
          // STRICT SECURITY: Never expose internal agent notes, handoff summaries, or customer-private metadata in widget
          if (
            msg.isInternal ||
            msg.metadata?.isInternal ||
            msg.senderRole === 'internal_note' ||
            msg.metadata?.type === 'INTERNAL_NOTE' ||
            msg.metadata?.type === 'TRANSFER_HANDOFF' ||
            msg.messageType === 'internal_note'
          ) {
            return null;
          }

          const isCustomer = msg.senderRole === 'customer';
          const isAgent = msg.senderRole === 'agent' || msg.senderId === 'agent_sarah';
          const isSystem = msg.senderRole === 'system';

          if (isSystem) {
            return (
              <div key={msg.id || index} className="flex justify-center my-2">
                <span className="px-3 py-1 rounded-full bg-[#161616] border border-[#262626] text-[10px] text-[#888888] font-medium">
                  {msg.text}
                </span>
              </div>
            );
          }

          const hasTranslatedText = Boolean(msg.metadata?.translatedText || msg.translatedText);
          const displayText = hasTranslatedText ? (msg.metadata?.translatedText || msg.translatedText) : msg.text;
          const originalText = msg.text;

          return (
            <div
              key={msg.id || index}
              className={`flex flex-col ${isCustomer ? 'items-end' : 'items-start'}`}
            >
              {/* Sender label */}
              <div className="flex items-center space-x-1.5 mb-1 px-1 text-[10px] text-[#666666]">
                {isCustomer ? (
                  <span>{activeCustomer?.name || 'You'}</span>
                ) : isAgent ? (
                  <span className="text-[#38BDF8] font-semibold flex items-center space-x-1">
                    <ShieldCheck className="w-3 h-3" />
                    <span>Sarah Lin (Agent)</span>
                  </span>
                ) : (
                  <span className="text-[#7CFF00] font-semibold flex items-center space-x-1">
                    <Sparkles className="w-3 h-3" />
                    <span>NovaCart AI</span>
                  </span>
                )}
                <span>•</span>
                <span>{new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                {hasTranslatedText && (
                  <span className="text-[9px] bg-[#1E2E1E] text-[#7CFF00] px-1 py-0.2 rounded font-mono">
                    Translated
                  </span>
                )}
              </div>

              {/* Message Bubble */}
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                  isCustomer
                    ? 'bg-[#7CFF00] text-[#090909] font-medium rounded-tr-none shadow-sm'
                    : isAgent
                      ? 'bg-[#182330] text-[#E2E8F0] border border-[#234E70] rounded-tl-none shadow-sm'
                      : 'bg-[#161616] text-[#E0E0E0] border border-[#262626] rounded-tl-none shadow-sm'
                }`}
              >
                {/* Text */}
                {displayText && (
                  <p className="whitespace-pre-wrap break-words">{displayText}</p>
                )}

                {/* Collapsible Original Message Inspection for customer transparency */}
                {hasTranslatedText && originalText && originalText !== displayText && (
                  <details className="text-[10px] text-[#888888] mt-1.5 pt-1 border-t border-[#333333]/50 cursor-pointer">
                    <summary className="hover:text-[#CCCCCC] select-none text-[9px] text-[#777777]">Original message</summary>
                    <p className="mt-1 p-1 bg-black/40 rounded border border-white/10 text-[10px] italic text-[#AAAAAA]">
                      "{originalText}"
                    </p>
                  </details>
                )}

                {/* Translation unavailable notice if flagged */}
                {msg.metadata?.translationUnavailable && (
                  <div className="mt-1.5 pt-1 text-[9px] text-[#F59E0B] flex items-center space-x-1">
                    <AlertTriangle className="w-2.5 h-2.5" />
                    <span>Translation service currently unavailable (showing original)</span>
                  </div>
                )}

                {/* Attachment if present */}
                {msg.attachment && (msg.attachment.dataUrl || msg.attachment.id) && (
                  <div className="mt-2 rounded-lg overflow-hidden border border-[#333333] space-y-1">
                    {msg.attachment.dataUrl && (
                      <img
                        src={msg.attachment.dataUrl}
                        alt={msg.attachment.name || "Attachment"}
                        className="max-h-48 object-cover w-full"
                      />
                    )}
                    <div className="bg-[#111111] px-2.5 py-1.5 flex items-center justify-between text-[10px] text-[#888888] gap-2">
                      <span className="truncate text-[#CCCCCC]" title={msg.attachment.name}>
                        {msg.attachment.name}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadAttachment(msg.attachment);
                        }}
                        disabled={downloadingAttId === (msg.attachment.id || msg.attachment.name)}
                        className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-[#1A1A1A] hover:bg-[#252525] border border-[#333333] hover:border-[#7CFF00]/50 text-[#7CFF00] font-medium transition-colors shrink-0 disabled:opacity-50"
                        title={`Download ${msg.attachment.name || 'attachment'}`}
                      >
                        {downloadingAttId === (msg.attachment.id || msg.attachment.name) ? (
                          <Loader2 className="w-2.5 h-2.5 animate-spin text-[#7CFF00]" />
                        ) : (
                          <ArrowDownToLine className="w-2.5 h-2.5 text-[#7CFF00]" />
                        )}
                        <span>Download</span>
                      </button>
                    </div>
                    {downloadError[msg.attachment.id || msg.attachment.name] && (
                      <div className="bg-[#2A0808] text-[#FF4D4D] text-[9px] px-2 py-0.5 border border-[#551010]">
                        {downloadError[msg.attachment.id || msg.attachment.name]}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Typing indicator when sending / awaiting reply */}
        {isSending && (
          <div className="flex items-center space-x-2 text-xs text-[#888888] pl-2">
            <span className="w-2 h-2 rounded-full bg-[#7CFF00] animate-bounce"></span>
            <span className="w-2 h-2 rounded-full bg-[#7CFF00] animate-bounce [animation-delay:0.2s]"></span>
            <span className="w-2 h-2 rounded-full bg-[#7CFF00] animate-bounce [animation-delay:0.4s]"></span>
            <span className="text-[11px] text-[#666666]">NovaCart AI is typing...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 5. Attachment Preview Bar if selected */}
      {attachment && (
        <div className="px-3 py-1.5 bg-[#141414] border-t border-[#1E1E1E] flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2 truncate">
            <Paperclip className="w-3.5 h-3.5 text-[#7CFF00]" />
            <span className="text-[#CCCCCC] truncate text-[11px]">{attachment.name}</span>
          </div>
          <button
            onClick={() => setAttachment(null)}
            className="text-[#FF3366] hover:underline text-[11px]"
          >
            Remove
          </button>
        </div>
      )}

      {/* 6. Message Input & Dispatch Bar */}
      <div className="p-3 bg-[#111111] border-t border-[#1E1E1E] shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center space-x-2"
        >
          {/* File upload button */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*,.pdf"
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-xl bg-[#1A1A1A] hover:bg-[#222222] text-[#888888] hover:text-[#FFFFFF] border border-[#2A2A2A] transition-colors shrink-0"
            title="Attach evidence photo or document"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          {/* Text input */}
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={t.inputPlaceholder || "Type your message in English, हिंदी, मराठी..."}
            className="flex-1 bg-[#161616] text-[#FFFFFF] text-xs px-3.5 py-2.5 rounded-xl border border-[#2A2A2A] focus:border-[#7CFF00] focus:outline-none placeholder-[#555555] transition-colors"
          />

          {/* Send button */}
          <button
            type="submit"
            disabled={(!inputText.trim() && !attachment) || isSending}
            style={{ backgroundColor: effectiveTheme.primaryColor, color: effectiveTheme.primaryTextColor }}
            className={`p-2.5 rounded-xl flex items-center justify-center font-bold transition-all shrink-0 ${
              (!inputText.trim() && !attachment) || isSending
                ? 'opacity-40 cursor-not-allowed'
                : 'hover:scale-105 active:scale-95 shadow-neon-sm'
            }`}
          >
            <Send className="w-4 h-4 fill-current stroke-current" />
          </button>
        </form>

        {/* Footer branding */}
        <div className="mt-2 flex items-center justify-between text-[10px] text-[#555555]">
          <span className="flex items-center space-x-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7CFF00]"></span>
            <span>Nexconn Real-Time Channel</span>
          </span>
          <span>Powered by Resolve AI</span>
        </div>
      </div>
    </div>
  );
}

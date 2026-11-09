import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  UserCheck, 
  ChevronDown, 
  ChevronUp, 
  ShoppingBag,
  Paperclip,
  Image as ImageIcon,
  X,
  Download,
  Globe,
  Star
} from 'lucide-react';
import { DEMO_CUSTOMERS } from '../data/demoData';
import { requestHumanAssistance, getTicket, updateTicket, submitResolutionFeedback, translateText } from '../services/api';
import nexconnService from '../services/nexconnService';
import { TRANSLATIONS, SUPPORTED_LANGUAGES } from '../utils/translations';

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
  
  // Multilingual Support
  const [currentLang, setCurrentLang] = useState('en');
  const t = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
  const [agentTranslationsMap, setAgentTranslationsMap] = useState({});
  const [translatingAgentIds, setTranslatingAgentIds] = useState(new Set());

  // Attachment Support
  const [attachment, setAttachment] = useState(null);
  const [lightboxImage, setLightboxImage] = useState(null);
  const fileInputRef = useRef(null);

  // Resolution Feedback State
  const [feedbackResolved, setFeedbackResolved] = useState(true);
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

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
    setAttachment(null);
    setFeedbackSubmitted(false);

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

    if (storedStatus?.feedback) {
      setFeedbackSubmitted(true);
    }

    // Also fetch latest from backend
    if (ticketId) {
      getTicket(ticketId)
        .then((res) => {
          if (res?.ticket?.status) {
            const beStatus = res.ticket.status;
            setTicketStatus(beStatus);
            setHumanRequested(beStatus === 'Human Requested' || beStatus === 'Human Agent Active');
            nexconnService.setTicketStatus(ticketId, beStatus, { lastUpdated: res.ticket.lastUpdated });
            if (res.ticket.feedback) {
              setFeedbackSubmitted(true);
            }
          }
        })
        .catch(() => {});
    }

    // 3. Subscribe ONLY to this customer's persistent channel
    const unsubscribe = nexconnService.subscribe(channelId, (newMsg) => {
      // If it's a real chat message (not metadata-only), add to message stream
      if (!newMsg.isMetadataOnly && (newMsg.text || newMsg.attachment)) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id || (m.messageId && m.messageId === newMsg.messageId))) {
            return prev;
          }
          return [...prev, newMsg];
        });
      }

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

  // Handle File Selection for Image Attachments (<5MB)
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file (PNG, JPEG, WebP)');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert('File size exceeds 5MB limit. Please select a smaller photo.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setAttachment({
        name: file.name,
        size: file.size,
        type: file.type,
        dataUrl: reader.result,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Translate agent responses for multilingual customers
  const handleTranslateAgentMessage = async (msgId, text, targetLang) => {
    if (agentTranslationsMap[msgId] || translatingAgentIds.has(msgId)) return;
    setTranslatingAgentIds((prev) => new Set(prev).add(msgId));
    try {
      const res = await translateText({
        text,
        targetLanguage: targetLang,
        sourceLanguage: 'en',
      });
      if (res?.translatedText) {
        setAgentTranslationsMap((prev) => ({
          ...prev,
          [msgId]: res.translatedText,
        }));
      }
    } catch (err) {
      console.warn('Customer translation error:', err);
    } finally {
      setTranslatingAgentIds((prev) => {
        const next = new Set(prev);
        next.delete(msgId);
        return next;
      });
    }
  };

  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if ((!inputText.trim() && !attachment) || isSending) return;

    const textToSend = inputText.trim();
    const channelId = customer.channelId || `channel_${customer.order.orderId}`;
    const currentAttachment = attachment;
    const ticketId = customer.ticket?.id;

    // Explicit ticket reopening lifecycle: If ticket was Resolved, customer message transitions it back to active handling
    const wasResolved = ticketStatus === 'Resolved';
    const newStatus = wasResolved ? 'AI Handling' : ticketStatus;

    if (wasResolved) {
      setTicketStatus('AI Handling');
      setHumanRequested(false);
      setFeedbackSubmitted(false);
      if (ticketId) {
        nexconnService.setTicketStatus(ticketId, 'AI Handling');
        updateTicket(ticketId, { status: 'AI Handling' }).catch(console.warn);
      }
    }

    setInputText('');
    setAttachment(null);
    setIsSending(true);

    try {
      const sentMsg = await nexconnService.sendMessage({
        targetUserId: 'agent_sarah',
        channelId,
        text: textToSend,
        attachment: currentAttachment,
        metadata: {
          orderId: customer.order.orderId,
          ticketId,
          language: currentLang,
          status: newStatus,
          isReopened: wasResolved,
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
        text: currentLang === 'hi'
          ? 'मानव सहायता का अनुरोध किया गया है। सारा लिन जल्द ही इस बातचीत में शामिल होंगी।'
          : currentLang === 'mr'
          ? 'मानवी सहाय्याची विनंती केली आहे. सारा लिन लवकरच या संभाषणात सहभागी होतील.'
          : 'Human assistance has been requested. Sarah Lin has been notified and will join this conversation shortly.',
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
          language: currentLang,
        },
      });

      nexconnService.dispatchToChannel(channelId, systemNotice);
      setMessages(nexconnService.getChannelMessages(channelId));
    } catch (err) {
      console.error('Failed to request human assistance:', err);
    }
  };

  // Smart Quick Action Handlers
  const handleQuickAction = (actionKey) => {
    if (actionKey === 'track') {
      setShowOrderDetails(true);
    } else if (actionKey === 'return') {
      const msg = currentLang === 'hi'
        ? `मैं ऑर्डर #${customer?.order?.orderId} के लिए 7-दिवसीय नीति के तहत वापसी का अनुरोध करना चाहता हूँ।`
        : currentLang === 'mr'
        ? `मी ऑर्डर #${customer?.order?.orderId} साठी 7 दिवसांच्या धोरणांतर्गत परतावा विनंती करू इच्छितो.`
        : `I would like to request a return for order #${customer?.order?.orderId} under the 7-day return policy.`;
      setInputText(msg);
    } else if (actionKey === 'damage') {
      fileInputRef.current?.click();
      const msg = currentLang === 'hi'
        ? 'मुझे क्षतिग्रस्त उत्पाद प्राप्त हुआ है, जांच के लिए फोटो संलग्न है।'
        : currentLang === 'mr'
        ? 'मला खराब झालेले उत्पादन मिळाले आहे, तपासणीसाठी फोटो जोडला आहे.'
        : 'I received a damaged product and have attached a photo for inspection.';
      setInputText(msg);
    } else if (actionKey === 'human') {
      handleRequestHuman();
    }
  };

  // Resolution Feedback Submission: Stored strictly as structured ticket metadata without creating duplicate chat messages
  const handleSubmitFeedback = async () => {
    const ticketId = customer?.ticket?.id;
    if (!ticketId || isSubmittingFeedback) return;

    setIsSubmittingFeedback(true);
    const feedbackPayload = {
      resolved: feedbackResolved,
      rating: feedbackRating,
      comment: feedbackComment.trim(),
      submittedAt: new Date().toISOString(),
    };

    try {
      await submitResolutionFeedback(ticketId, feedbackPayload).catch(console.warn);
      nexconnService.setTicketFeedback(ticketId, feedbackPayload);

      // Broadcast metadata event without polluting conversation history with a duplicate chat message
      const channelId = customer.channelId || `channel_${customer.order.orderId}`;
      nexconnService.broadcastMetadata({
        channelId,
        metadata: {
          ticketId,
          feedback: feedbackPayload,
          type: 'FEEDBACK_SUBMITTED',
        },
      });

      setFeedbackSubmitted(true);
    } catch (err) {
      console.error('Failed to submit resolution feedback:', err);
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  // Download Transcript as .txt file
  const handleDownloadTranscript = () => {
    const lines = [
      `NovaCart Support - Conversation Transcript`,
      `Customer: ${customer?.name} (${customer?.id})`,
      `Order: #${customer?.order?.orderId} - ${customer?.order?.product}`,
      `Date: ${new Date().toLocaleString()}`,
      `Status: ${ticketStatus}`,
      `------------------------------------------------------------\n`,
      ...messages.map((m) => {
        const time = new Date(m.timestamp).toLocaleTimeString();
        const sender = m.senderRole === 'customer' ? customer?.name : m.senderName || 'Agent';
        const attInfo = m.attachment ? ` [Attachment: ${m.attachment.name}]` : '';
        return `[${time}] ${sender}: ${m.text}${attInfo}`;
      }),
      `\n------------------------------------------------------------`,
      `End of Transcript`
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `NovaCart_Transcript_${customer?.order?.orderId}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const smartActions = [
    { key: 'track', label: t.quickTrackOrder },
    { key: 'return', label: t.quickReturn },
    { key: 'damage', label: t.quickDamage },
    { key: 'human', label: t.quickHuman },
  ];

  return (
    <div className="flex flex-col h-full bg-[#0A0A0A] overflow-hidden relative">
      {/* Consolidated Single Header */}
      <div className="px-5 py-3.5 bg-[#0D0D0D] border-b border-[#1A1A1A] shrink-0 space-y-2.5">
        {/* Top Row: Brand & Cohesive Control Toolbar */}
        <div className="flex items-center justify-between gap-3">
          {/* NovaCart Branding (Clean single-line brand and status indicator) */}
          <div className="flex items-center space-x-2.5 shrink-0">
            <div className="w-8 h-8 rounded-xl bg-[#161616] border border-[#262626] flex items-center justify-center text-[#7CFF00] shrink-0 shadow-sm">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-sm text-[#FFFFFF] tracking-tight whitespace-nowrap">
                {t.brandName}
              </span>
              <div className="hidden sm:flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-[#121A10] border border-[#7CFF00]/20 text-[10px] text-[#7CFF00] font-semibold whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-[#7CFF00] shadow-neon-sm" />
                <span>{t.connectionLive}</span>
              </div>
            </div>
          </div>

          {/* Grouped Secondary Controls: Language + Transcript + Persona Switcher */}
          <div className="flex items-center space-x-2 shrink-0">
            {/* Language Selector Dropdown */}
            <div className="flex items-center space-x-1.5 bg-[#141414] px-2.5 py-1 rounded-xl border border-[#222222] text-xs">
              <Globe className="w-3.5 h-3.5 text-[#7CFF00] shrink-0" />
              <select
                id="customer-language-select"
                value={currentLang}
                onChange={(e) => setCurrentLang(e.target.value)}
                className="bg-transparent text-[#FFFFFF] font-semibold text-xs focus:outline-none cursor-pointer"
                title="Select Language"
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code} className="bg-[#141414] text-[#FFFFFF]">
                    {lang.native} ({lang.code.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>

            {/* Transcript Download Button */}
            <button
              onClick={handleDownloadTranscript}
              className="p-1.5 rounded-xl bg-[#141414] border border-[#222222] text-[#8A8A8A] hover:text-[#FFFFFF] hover:border-[#7CFF00]/40 transition-colors shrink-0"
              title={t.downloadTranscript}
            >
              <Download className="w-3.5 h-3.5 text-[#7CFF00]" />
            </button>

            {/* Persona Switcher Tabs */}
            <div className="flex items-center space-x-1 bg-[#141414] p-1 rounded-xl border border-[#222222] shrink-0">
              {DEMO_CUSTOMERS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onSelectCustomer(c)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
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
        </div>

        {/* Dedicated Order Context Row with Product Thumbnail & Canonical Status */}
        <div className="flex items-center justify-between pt-2 border-t border-[#181818] text-xs">
          <div className="flex items-center space-x-2.5 min-w-0">
            {(customer?.order?.productThumbnail || customer?.order?.image) ? (
              <img
                src={customer.order.productThumbnail || customer.order.image}
                alt={customer.order.product}
                className="w-7 h-7 rounded-lg object-cover border border-[#262626] shrink-0"
              />
            ) : null}

            <div className="flex items-center space-x-2 min-w-0">
              <span className="font-mono text-[#7CFF00] text-xs font-semibold shrink-0">
                #{customer?.order?.orderId}
              </span>
              <span className="text-[#333333]">·</span>
              <span className="text-[#CCCCCC] font-medium text-xs truncate max-w-[140px] sm:max-w-xs">
                {customer?.order?.product}
              </span>
              <span className="text-[#333333]">·</span>
              <button
                onClick={() => setShowOrderDetails(!showOrderDetails)}
                className="text-[#8A8A8A] hover:text-[#FFFFFF] underline text-xs flex items-center space-x-0.5 shrink-0 transition-colors"
              >
                <span>{showOrderDetails ? t.hideTracking : t.viewTracking}</span>
                {showOrderDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Single Prominent Status Indicator & Action */}
          <div className="flex items-center space-x-2 shrink-0">
            {ticketStatus === 'Resolved' ? (
              <span id="customer-status-badge-resolved" className="text-xs text-[#7CFF00] font-semibold px-2.5 py-0.5 rounded-full bg-[#7CFF00]/10 border border-[#7CFF00]/30">
                {t.statusResolved}
              </span>
            ) : ticketStatus === 'Human Agent Active' ? (
              <span id="customer-status-badge-active" className="text-xs text-[#FFFFFF] font-semibold px-2.5 py-0.5 rounded-full bg-[#161616] border border-[#2A2A2A] flex items-center space-x-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#7CFF00] shadow-neon-sm" />
                <span>{t.statusAgentActive}</span>
              </span>
            ) : ticketStatus === 'Human Requested' ? (
              <span id="customer-status-badge-requested" className="text-xs text-[#FF334B] font-semibold px-2.5 py-0.5 rounded-full bg-[#250C10] border border-[#5C151F]">
                {t.statusHumanRequested}
              </span>
            ) : (
              <div className="flex items-center space-x-2">
                <span id="customer-status-badge-ai" className="text-xs text-[#8A8A8A] font-semibold px-2.5 py-0.5 rounded-full bg-[#161616] border border-[#262626] flex items-center space-x-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#7CFF00]" />
                  <span>{t.statusAIHandling}</span>
                </span>
                <button
                  id="btn-request-human"
                  onClick={handleRequestHuman}
                  className="flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-[#161616] hover:bg-[#202020] text-[#FFFFFF] border border-[#262626] hover:border-[#7CFF00]/50 transition-colors shadow-sm"
                >
                  <UserCheck className="w-3.5 h-3.5 text-[#7CFF00]" />
                  <span>Request Human</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Expandable Tracking Details */}
        {showOrderDetails && (
          <div className="p-3 rounded-xl bg-[#141414] border border-[#222222] text-xs text-[#8A8A8A] leading-relaxed animate-fadeIn">
            <div className="flex items-center justify-between text-[#8A8A8A] mb-1.5">
              <span>{t.deliveryStatus}: <strong className="text-[#FFFFFF]">{customer?.order?.status}</strong></span>
              <span>{t.carrier}: <strong className="text-[#FFFFFF]">{customer?.order?.carrier}</strong></span>
            </div>
            <span className="text-[#555555] block text-[10px] uppercase font-bold">{t.latestUpdate}</span>
            <span className="text-[#FFFFFF] text-xs">{customer?.order?.trackingStatus}</span>
          </div>
        )}
      </div>

      {/* Spacious Conversation Stream */}
      <div id="customer-chat-messages" className="flex-1 overflow-y-auto px-6 lg:px-8 py-6 space-y-6 bg-[#090909]">
        {messages.map((msg) => {
          const isMe = msg.senderRole === 'customer' || msg.senderId === customer?.id;
          const isAgent = msg.senderRole === 'agent' || msg.senderId === 'agent_sarah';
          const isSystem = msg.senderRole === 'system';
          const att = msg.attachment || msg.metadata?.attachment;

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
              <div className="flex items-center space-x-2 mb-1.5 px-1 text-xs text-[#8A8A8A]">
                <span className={isMe ? 'text-[#7CFF00] font-semibold' : 'text-[#FFFFFF] font-semibold'}>
                  {isMe ? 'You' : msg.senderName || 'Support Agent'}
                </span>
                <span>·</span>
                <span className="font-mono text-[11px]">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              <div
                className={`max-w-[75%] rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed ${
                  isMe
                    ? 'bg-[#181818] border border-[#2A2A2A] text-[#FFFFFF]'
                    : 'bg-[#121212] border border-[#222222] text-[#EAEAEA]'
                }`}
              >
                {/* Original Message Text */}
                <p className="whitespace-pre-wrap">{msg.text}</p>

                {/* Multilingual Translation for Agent Messages when customer selected non-English */}
                {isAgent && currentLang !== 'en' && (
                  <div className="mt-2.5 pt-2 border-t border-[#262626] text-xs">
                    {agentTranslationsMap[msg.id] ? (
                      <div className="bg-[#161616] p-2.5 rounded-lg border border-[#242424] space-y-1">
                        <div className="flex items-center space-x-1.5 text-[10px] text-[#7CFF00] font-semibold">
                          <Globe className="w-3 h-3" />
                          <span>{t.translationLabel}</span>
                        </div>
                        <p className="text-[#E0E0E0] italic text-xs leading-relaxed">
                          "{agentTranslationsMap[msg.id]}"
                        </p>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleTranslateAgentMessage(msg.id, msg.text, currentLang)}
                        disabled={translatingAgentIds.has(msg.id)}
                        className="text-[11px] text-[#60A5FA] hover:text-[#93C5FD] underline flex items-center space-x-1 transition-colors"
                      >
                        <Globe className="w-3 h-3" />
                        <span>
                          {translatingAgentIds.has(msg.id) ? t.translating : t.viewTranslation}
                        </span>
                      </button>
                    )}
                  </div>
                )}

                {/* Render Customer Image Attachments */}
                {att && att.dataUrl && (
                  <div className="mt-3 pt-2 border-t border-[#222222] space-y-1.5">
                    <div 
                      onClick={() => setLightboxImage(att.dataUrl)}
                      className="cursor-pointer group relative overflow-hidden rounded-xl border border-[#2A2A2A] max-w-[260px] bg-[#0A0A0A] hover:border-[#7CFF00]/50 transition-colors"
                    >
                      <img
                        src={att.dataUrl}
                        alt={att.name || 'Photo'}
                        className="max-h-48 w-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    </div>
                    <div className="flex items-center space-x-2 text-[11px] text-[#8A8A8A]">
                      <ImageIcon className="w-3.5 h-3.5 text-[#7CFF00] shrink-0" />
                      <span className="truncate max-w-[160px] text-[#CCCCCC]">{att.name}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Resolution Feedback Card (Shown when ticket is Resolved) */}
      {ticketStatus === 'Resolved' && (
        <div className="px-6 py-3 bg-[#0E150D] border-t border-[#7CFF00]/30 shrink-0 animate-fadeIn">
          {feedbackSubmitted ? (
            <div className="flex items-center justify-between py-1 text-xs text-[#7CFF00]">
              <span className="font-semibold">{t.feedbackThankYou}</span>
              <span className="text-[10px] text-[#8A8A8A]">Rating recorded: {'⭐'.repeat(feedbackRating)}</span>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[#FFFFFF]">{t.feedbackTitle}</span>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setFeedbackResolved(true)}
                    className={`px-2.5 py-0.5 rounded-lg text-xs font-semibold transition-all ${
                      feedbackResolved ? 'bg-[#7CFF00] text-[#090909]' : 'bg-[#181818] text-[#8A8A8A]'
                    }`}
                  >
                    {t.feedbackYes}
                  </button>
                  <button
                    onClick={() => setFeedbackResolved(false)}
                    className={`px-2.5 py-0.5 rounded-lg text-xs font-semibold transition-all ${
                      !feedbackResolved ? 'bg-[#FF334B] text-[#FFFFFF]' : 'bg-[#181818] text-[#8A8A8A]'
                    }`}
                  >
                    {t.feedbackNo}
                  </button>
                </div>
              </div>

              <div className="flex items-center space-x-3 text-xs">
                <span className="text-[#8A8A8A] text-[11px]">{t.feedbackRating}</span>
                <div className="flex items-center space-x-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => setFeedbackRating(star)}
                      className="p-0.5 text-sm transition-transform hover:scale-125 focus:outline-none"
                    >
                      <Star className={`w-4 h-4 ${star <= feedbackRating ? 'text-[#7CFF00] fill-[#7CFF00]' : 'text-[#444444]'}`} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={feedbackComment}
                  onChange={(e) => setFeedbackComment(e.target.value)}
                  placeholder={t.feedbackPlaceholder}
                  className="flex-1 bg-[#141414] border border-[#222222] rounded-xl px-3 py-1.5 text-xs text-[#FFFFFF] placeholder-[#666666] focus:outline-none focus:border-[#7CFF00]"
                />
                <button
                  onClick={handleSubmitFeedback}
                  disabled={isSubmittingFeedback}
                  className="px-3.5 py-1.5 rounded-xl bg-[#7CFF00] hover:bg-[#8EFF1F] text-[#090909] text-xs font-bold transition-all shadow-neon-sm"
                >
                  {t.feedbackSubmit}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Smart Quick Actions Strip: Smooth horizontal scroll with visible scrollbar & full end accessibility */}
      <div className="px-4 md:px-6 py-2.5 bg-[#0D0D0D] border-t border-[#181818] w-full overflow-x-auto scrollbar-thin scrollbar-thumb-[#252525] shrink-0">
        <div className="flex items-center gap-2 min-w-max pr-6">
          <span className="text-[11px] text-[#555555] shrink-0 font-bold uppercase tracking-wider">{t.quickAskPrefix}</span>
          {smartActions.map((action) => (
            <button
              key={action.key}
              onClick={() => handleQuickAction(action.key)}
              className="text-xs whitespace-nowrap bg-[#141414] hover:bg-[#1E1E1E] text-[#8A8A8A] hover:text-[#FFFFFF] hover:border-[#7CFF00]/40 px-3.5 py-1.5 rounded-full border border-[#222222] transition-colors shadow-sm"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {/* Image Attachment Preview Strip */}
      {attachment && (
        <div className="px-6 py-2 bg-[#121212] border-t border-[#222222] flex items-center justify-between shrink-0 animate-fadeIn">
          <div className="flex items-center space-x-3">
            <img
              src={attachment.dataUrl}
              alt={attachment.name}
              className="w-10 h-10 rounded-lg object-cover border border-[#333333]"
            />
            <div className="text-xs">
              <span className="text-[#FFFFFF] font-medium block truncate max-w-[200px]">{attachment.name}</span>
              <span className="text-[#8A8A8A] text-[10px]">{Math.round(attachment.size / 1024)} KB</span>
            </div>
          </div>
          <button
            onClick={() => setAttachment(null)}
            className="p-1 rounded-lg text-[#8A8A8A] hover:text-[#FF334B] transition-colors"
            title={t.removeAttachment}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Hidden File Input for Image Attachment */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Fixed Composer at Bottom */}
      <form onSubmit={handleSendMessage} className="p-4 bg-[#0D0D0D] border-t border-[#1A1A1A] flex items-center space-x-2 shrink-0">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-2.5 rounded-xl bg-[#141414] hover:bg-[#1C1C1C] border border-[#222222] hover:border-[#7CFF00]/40 text-[#8A8A8A] hover:text-[#7CFF00] transition-colors shrink-0"
          title={t.attachPhoto}
        >
          <Paperclip className="w-4 h-4" />
        </button>

        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={ticketStatus === 'Resolved' ? t.inputResolvedPlaceholder : t.inputPlaceholder}
          disabled={isSending}
          className="flex-1 bg-[#141414] border border-[#222222] focus:border-[#7CFF00] rounded-xl px-4 py-2.5 text-sm text-[#FFFFFF] placeholder-[#666666] focus:outline-none transition-colors disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={(!inputText.trim() && !attachment) || isSending}
          className="px-5 py-2.5 rounded-xl bg-[#7CFF00] hover:bg-[#8EFF1F] text-[#090909] text-xs font-bold flex items-center space-x-1.5 transition-all shadow-neon-sm disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <span>{isSending ? t.sending : t.send}</span>
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>

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

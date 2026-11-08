import React, { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, 
  Send, 
  Edit3, 
  RefreshCw, 
  ChevronDown, 
  ChevronUp, 
  ShieldCheck, 
  X
} from 'lucide-react';
import { analyzeConversation, summarizeConversation, getSuggestedReply } from '../services/api';

export default function AICopilotPanel({
  ticket,
  messages,
  onApproveAndSend,
  onClose,
}) {
  const [analysis, setAnalysis] = useState(null);
  const [summary, setSummary] = useState(null);
  const [suggestedReply, setSuggestedReply] = useState('');
  const [isEditingReply, setIsEditingReply] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showFullAnalysis, setShowFullAnalysis] = useState(false);
  const [policyRefs, setPolicyRefs] = useState([]);

  // Ref to track currently active ticket ID and discard stale in-flight AI responses
  const activeTicketIdRef = useRef(ticket?.id);

  useEffect(() => {
    if (!ticket) return;
    activeTicketIdRef.current = ticket.id;

    // 1. Immediately reset data to the newly selected ticket
    setAnalysis({
      category: ticket.category,
      priority: ticket.priority,
      sentiment: ticket.sentiment,
      issueDescription: ticket.summary || ticket.customer?.order?.reportedIssue,
    });

    setSummary({
      whatHappened: ticket.summary,
      customerNeeds: `Resolution regarding ${ticket.customer?.order?.product || 'order'}.`,
      discussedSoFar: `Customer reported: "${ticket.customer?.order?.initialMessage?.substring(0, 60)}..."`,
      pendingAction: ticket.pendingAction || 'Review courier logs and approve suggested reply.',
    });

    setSuggestedReply(ticket.suggestedReply || '');
    setIsEditingReply(false);
    setPolicyRefs(
      ticket.category === 'Delivery Delay' 
        ? ['Standard delivery: 4–6 business days', 'Delivery estimates must be verified']
        : ticket.category === 'Refund Request'
        ? ['7-day return window from delivery', 'Return item verification at hub']
        : ['Supporting photograph required for incorrect items', 'Free expedited replacement']
    );

    // 2. Fetch fresh contextual AI suggestion
    handleRunAICopilot(ticket.id);
  }, [ticket?.id]);

  const handleRunAICopilot = async (targetTicketId) => {
    if (!ticket || !messages || messages.length === 0) return;
    setIsLoading(true);

    try {
      const payload = {
        messages: messages.map(m => ({
          sender: m.senderName,
          text: m.text,
          role: m.senderRole,
        })),
        customer: ticket.customer,
        order: ticket.customer?.order,
      };

      const [analysisRes, summaryRes, replyRes] = await Promise.allSettled([
        analyzeConversation(payload),
        summarizeConversation(payload),
        getSuggestedReply(payload),
      ]);

      // Guard against race condition: discard response if user switched tickets while request was in-flight
      if (activeTicketIdRef.current !== targetTicketId) {
        return;
      }

      if (analysisRes.status === 'fulfilled' && analysisRes.value?.data) {
        setAnalysis(analysisRes.value.data);
      }

      if (summaryRes.status === 'fulfilled' && summaryRes.value?.data) {
        setSummary(summaryRes.value.data);
      }

      if (replyRes.status === 'fulfilled' && replyRes.value?.data) {
        setSuggestedReply(replyRes.value.data.suggestedReply);
        if (replyRes.value.data.policyReferences) {
          setPolicyRefs(replyRes.value.data.policyReferences);
        }
      }
    } catch (err) {
      console.warn('AI copilot call note:', err);
    } finally {
      if (activeTicketIdRef.current === targetTicketId) {
        setIsLoading(false);
      }
    }
  };

  const handleSendReply = async () => {
    if (!suggestedReply.trim() || isSending || isLoading) return;
    setIsSending(true);
    try {
      await onApproveAndSend(suggestedReply.trim());
    } finally {
      setIsSending(false);
    }
  };

  const isUrgent = analysis?.priority?.toLowerCase() === 'critical' || analysis?.priority?.toLowerCase() === 'high';

  return (
    <div className="w-[320px] md:w-[340px] shrink-0 h-full bg-[#0D0D0D] border-l border-[#1A1A1A] flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
      {/* Drawer Header */}
      <div className="px-4 py-3 border-b border-[#1A1A1A] flex items-center justify-between shrink-0 bg-[#0F0F0F]">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-4 h-4 text-[#7CFF00]" />
          <span className="font-bold text-xs text-[#FFFFFF]">AI Copilot</span>
          <span className="text-[9px] text-[#7CFF00] font-mono px-1.5 py-0.2 rounded bg-[#7CFF00]/10 border border-[#7CFF00]/30">
            Gemini
          </span>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={() => handleRunAICopilot(ticket?.id)}
            disabled={isLoading}
            className="p-1 rounded text-[#8A8A8A] hover:text-[#7CFF00] transition-colors"
            title="Refresh Copilot"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#7CFF00]' : ''}`} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded text-[#8A8A8A] hover:text-[#FFFFFF] transition-colors"
              title="Close Copilot Panel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Drawer Body */}
      <div className="p-4 space-y-3 flex-1 overflow-y-auto">
        
        {/* A. Issue Overview */}
        <div className="bg-[#141414] border border-[#222222] rounded-xl p-3 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-[#8A8A8A]">Overview</span>
            <span className={`text-[10px] font-semibold px-2 py-0.2 rounded border ${
              isUrgent ? 'border-[#5C151F] bg-[#250C10] text-[#FF334B]' : 'border-[#282828] text-[#8A8A8A]'
            }`}>
              {analysis?.priority || 'Normal'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs pt-1">
            <div>
              <span className="text-[#555555] block text-[10px] uppercase font-medium">Category</span>
              <span className="text-[#FFFFFF] font-semibold truncate block">{analysis?.category || 'Inquiry'}</span>
            </div>
            <div>
              <span className="text-[#555555] block text-[10px] uppercase font-medium">Sentiment</span>
              <span className="text-[#FFFFFF] font-semibold truncate block">{analysis?.sentiment || 'Neutral'}</span>
            </div>
          </div>
        </div>

        {/* B. Suggested Response Card (Primary Copilot Focus) */}
        <div className="bg-[#141414] border border-[#7CFF00]/40 rounded-xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-1.5">
              <span className="text-xs font-bold text-[#FFFFFF]">Suggested Reply</span>
              <span className="text-[9px] text-[#7CFF00] font-mono px-1.5 py-0.2 rounded bg-[#7CFF00]/10 border border-[#7CFF00]/30">
                AI Draft
              </span>
            </div>

            <button
              onClick={() => setIsEditingReply(!isEditingReply)}
              className="text-[11px] text-[#8A8A8A] hover:text-[#7CFF00] flex items-center space-x-1 transition-colors"
            >
              <Edit3 className="w-3 h-3" />
              <span>{isEditingReply ? 'Done' : 'Edit'}</span>
            </button>
          </div>

          <div className="text-[10px] text-[#8A8A8A] flex items-center space-x-1 bg-[#0A0A0A] px-2 py-1 rounded border border-[#1E1E1E]">
            <ShieldCheck className="w-3.5 h-3.5 text-[#7CFF00] shrink-0" />
            <span>Human review required before sending</span>
          </div>

          {/* Editable text area or formatted text */}
          {isEditingReply ? (
            <textarea
              value={suggestedReply}
              onChange={(e) => setSuggestedReply(e.target.value)}
              rows={4}
              className="w-full bg-[#0A0A0A] border border-[#222222] focus:border-[#7CFF00] rounded-lg p-2.5 text-xs text-[#FFFFFF] focus:outline-none leading-relaxed"
            />
          ) : (
            <div className="bg-[#0A0A0A] border border-[#1E1E1E] rounded-lg p-2.5 text-xs text-[#FFFFFF] leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">
              {suggestedReply || 'Drafting contextual reply...'}
            </div>
          )}

          {/* Approve and Send Action Button */}
          <button
            onClick={handleSendReply}
            disabled={!suggestedReply.trim() || isLoading || isSending}
            className="w-full py-2.5 px-3 rounded-lg bg-[#7CFF00] hover:bg-[#8EFF1F] text-[#090909] text-xs font-bold flex items-center justify-center space-x-1.5 transition-all shadow-neon-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{isSending ? 'Sending...' : 'Approve & Send'}</span>
          </button>
        </div>

        {/* C. Conversation Summary */}
        <div className="bg-[#141414] border border-[#222222] rounded-xl p-3 text-xs space-y-1.5">
          <span className="text-[10px] uppercase font-bold text-[#8A8A8A] block">Context Summary</span>
          <div className="space-y-1 text-xs leading-relaxed">
            <div>
              <span className="text-[#555555] font-semibold">Issue: </span>
              <span className="text-[#FFFFFF]">{summary?.whatHappened || 'Analyzing issue...'}</span>
            </div>
            <div>
              <span className="text-[#555555] font-semibold">Pending: </span>
              <span className="text-[#FFFFFF]">{summary?.pendingAction || 'Agent response.'}</span>
            </div>
          </div>
        </div>

        {/* D. Full Analysis & Policy (Collapsible Accordion) */}
        <div className="border border-[#222222] rounded-xl bg-[#141414] overflow-hidden">
          <button
            onClick={() => setShowFullAnalysis(!showFullAnalysis)}
            className="w-full px-3 py-2 text-left text-xs font-medium text-[#8A8A8A] hover:text-[#FFFFFF] flex items-center justify-between bg-[#141414] hover:bg-[#1A1A1A] transition-colors"
          >
            <span>Policy Guidelines</span>
            {showFullAnalysis ? <ChevronUp className="w-3.5 h-3.5 text-[#7CFF00]" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {showFullAnalysis && (
            <div className="p-3 border-t border-[#222222] space-y-2 text-xs text-[#8A8A8A] animate-fadeIn">
              <div className="space-y-1.5">
                {policyRefs.map((pol, i) => (
                  <div key={i} className="flex items-start space-x-1.5 text-xs text-[#FFFFFF]">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#7CFF00] shrink-0 mt-0.5" />
                    <span>{pol}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
import React, { useState, useEffect } from 'react';
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

  useEffect(() => {
    if (!ticket) return;

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
    setPolicyRefs(
      ticket.category === 'Delivery Delay' 
        ? ['Standard delivery: 4–6 business days', 'Delivery estimates must be verified']
        : ticket.category === 'Refund Request'
        ? ['7-day return window from delivery', 'Return item verification at hub']
        : ['Supporting photograph required for incorrect items', 'Free expedited replacement']
    );

    handleRunAICopilot();
  }, [ticket?.id]);

  const handleRunAICopilot = async () => {
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
      setIsLoading(false);
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
    <div className="flex flex-col h-full bg-[#0E0E0E] border-l border-[#222222] overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#222222] flex items-center justify-between shrink-0 bg-[#0E0E0E]">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-3.5 h-3.5 text-[#7CFF00]" />
          <span className="font-bold text-xs text-[#FFFFFF]">AI Copilot</span>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={handleRunAICopilot}
            disabled={isLoading}
            className="p-1.5 rounded text-[#8A8A8A] hover:text-[#7CFF00] transition-colors"
            title="Refresh Copilot"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#7CFF00]' : ''}`} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded text-[#8A8A8A] hover:text-[#FFFFFF] transition-colors"
              title="Close Panel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4 flex-1">
        
        {/* A. Compact Issue Overview */}
        <div className="bg-[#161616] border border-[#222222] rounded p-3 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-[#8A8A8A]">Issue Overview</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
              isUrgent ? 'border-[#5C151F] bg-[#250C10] text-[#FF334B]' : 'border-[#282828] text-[#8A8A8A]'
            }`}>
              {analysis?.priority || 'Normal'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
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

        {/* B. Concise Conversation Summary */}
        <div className="bg-[#161616] border border-[#222222] rounded p-3 text-xs space-y-2">
          <span className="text-[10px] uppercase font-bold text-[#8A8A8A] block">Summary</span>
          <div className="space-y-1.5 text-[11px] leading-relaxed">
            <div>
              <span className="text-[#555555] font-semibold">Issue: </span>
              <span className="text-[#FFFFFF]">{summary?.whatHappened || 'Analyzing issue...'}</span>
            </div>
            <div>
              <span className="text-[#555555] font-semibold">Customer Needs: </span>
              <span className="text-[#FFFFFF]">{summary?.customerNeeds || 'Clarification.'}</span>
            </div>
            <div>
              <span className="text-[#555555] font-semibold">Pending Action: </span>
              <span className="text-[#FFFFFF]">{summary?.pendingAction || 'Agent response.'}</span>
            </div>
          </div>
        </div>

        {/* C. Suggested Response (Primary Focus of Copilot) */}
        <div className="bg-[#161616] border border-[#7CFF00]/30 rounded p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-[#FFFFFF]">Suggested Response</span>
              <span className="text-[10px] text-[#7CFF00] font-mono px-1.5 py-0.5 rounded bg-[#7CFF00]/10 border border-[#7CFF00]/30">
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

          <div className="text-[11px] text-[#8A8A8A] flex items-center space-x-1.5 bg-[#0E0E0E] px-2.5 py-1.5 rounded border border-[#222222]">
            <ShieldCheck className="w-3.5 h-3.5 text-[#7CFF00] shrink-0" />
            <span>Review and edit before sending. Human approval is required.</span>
          </div>

          {/* Editable text area or formatted text */}
          {isEditingReply ? (
            <textarea
              value={suggestedReply}
              onChange={(e) => setSuggestedReply(e.target.value)}
              rows={5}
              className="w-full bg-[#0E0E0E] border border-[#222222] focus:border-[#7CFF00] rounded p-2.5 text-xs text-[#FFFFFF] focus:outline-none leading-relaxed"
            />
          ) : (
            <div className="bg-[#0E0E0E] border border-[#222222] rounded p-2.5 text-xs text-[#FFFFFF] leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
              {suggestedReply || 'Drafting suggested reply based on customer context...'}
            </div>
          )}

          {/* Approve and Send Action Button with Double-Click Protection */}
          <button
            onClick={handleSendReply}
            disabled={!suggestedReply.trim() || isLoading || isSending}
            className="w-full py-2 px-3 rounded bg-[#7CFF00] hover:bg-[#8EFF1F] text-[#090909] text-xs font-bold flex items-center justify-center space-x-1.5 transition-all shadow-neon-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{isSending ? 'Sending...' : 'Approve & Send'}</span>
          </button>
        </div>

        {/* D. Full Analysis (Expandable Section - Collapsed by Default) */}
        <div className="border border-[#222222] rounded bg-[#161616] overflow-hidden">
          <button
            onClick={() => setShowFullAnalysis(!showFullAnalysis)}
            className="w-full px-3 py-2 text-left text-xs font-medium text-[#8A8A8A] hover:text-[#FFFFFF] flex items-center justify-between bg-[#161616] hover:bg-[#1E1E1E] transition-colors"
          >
            <span>Full Analysis & Policy Context</span>
            {showFullAnalysis ? <ChevronUp className="w-3.5 h-3.5 text-[#7CFF00]" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {showFullAnalysis && (
            <div className="p-3 border-t border-[#222222] space-y-2.5 text-xs text-[#8A8A8A] animate-fadeIn">
              <div>
                <span className="text-[10px] uppercase font-bold text-[#555555] block">Detailed Context</span>
                <p className="text-[#FFFFFF] text-[11px] leading-relaxed mt-0.5">
                  {analysis?.issueDescription || 'No extended notes.'}
                </p>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-[#555555] block">Applied Policies</span>
                <div className="space-y-1 mt-1">
                  {policyRefs.map((pol, i) => (
                    <div key={i} className="flex items-center space-x-1.5 text-[11px] text-[#FFFFFF]">
                      <ShieldCheck className="w-3 h-3 text-[#7CFF00] shrink-0" />
                      <span>{pol}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

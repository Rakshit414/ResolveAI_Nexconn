import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Send, 
  Edit3, 
  RefreshCw, 
  ChevronDown, 
  ChevronUp, 
  ShieldCheck, 
  X,
  Check
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

  const handleSendReply = () => {
    if (!suggestedReply.trim()) return;
    onApproveAndSend(suggestedReply.trim());
  };

  const isUrgent = analysis?.priority?.toLowerCase() === 'critical' || analysis?.priority?.toLowerCase() === 'high';

  return (
    <div className="flex flex-col h-full bg-[#111311] border-l border-[#353B35] overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#353B35] flex items-center justify-between shrink-0 bg-[#111311]">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-3.5 h-3.5 text-[#174B35]" />
          <span className="font-semibold text-xs text-[#D5D9D3]">AI Copilot</span>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={handleRunAICopilot}
            disabled={isLoading}
            className="p-1.5 rounded text-[#929A91] hover:text-[#D5D9D3] transition-colors"
            title="Refresh Copilot"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#174B35]' : ''}`} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded text-[#929A91] hover:text-[#D5D9D3] transition-colors"
              title="Close Panel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4 flex-1">
        
        {/* A. Compact Issue Overview */}
        <div className="bg-[#191A19] border border-[#353B35] rounded p-3 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-semibold text-[#929A91]">Issue Overview</span>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${
              isUrgent ? 'border-[#5C1721] bg-[#2A1316] text-[#A51F32]' : 'border-[#353B35] text-[#929A91]'
            }`}>
              {analysis?.priority || 'Normal'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
            <div>
              <span className="text-[#687267] block text-[10px]">Category</span>
              <span className="text-[#D5D9D3] font-medium truncate block">{analysis?.category || 'Inquiry'}</span>
            </div>
            <div>
              <span className="text-[#687267] block text-[10px]">Sentiment</span>
              <span className="text-[#D5D9D3] font-medium truncate block">{analysis?.sentiment || 'Neutral'}</span>
            </div>
          </div>
        </div>

        {/* B. Concise Conversation Summary */}
        <div className="bg-[#191A19] border border-[#353B35] rounded p-3 text-xs space-y-2">
          <span className="text-[10px] uppercase font-semibold text-[#929A91] block">Summary</span>
          <div className="space-y-1.5 text-[11px] leading-relaxed">
            <div>
              <span className="text-[#687267] font-medium">Issue: </span>
              <span className="text-[#D5D9D3]">{summary?.whatHappened || 'Analyzing issue...'}</span>
            </div>
            <div>
              <span className="text-[#687267] font-medium">Customer Needs: </span>
              <span className="text-[#D5D9D3]">{summary?.customerNeeds || 'Clarification.'}</span>
            </div>
            <div>
              <span className="text-[#687267] font-medium">Pending Action: </span>
              <span className="text-[#D5D9D3]">{summary?.pendingAction || 'Agent response.'}</span>
            </div>
          </div>
        </div>

        {/* C. Suggested Response (Primary Focus of Copilot) */}
        <div className="bg-[#242724] border border-[#353B35] rounded p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#D5D9D3] flex items-center space-x-1.5">
              <span>Suggested Response</span>
            </span>

            <button
              onClick={() => setIsEditingReply(!isEditingReply)}
              className="text-[11px] text-[#929A91] hover:text-[#D5D9D3] flex items-center space-x-1 transition-colors"
            >
              <Edit3 className="w-3 h-3" />
              <span>{isEditingReply ? 'Done' : 'Edit'}</span>
            </button>
          </div>

          {/* Editable text area or formatted text */}
          {isEditingReply ? (
            <textarea
              value={suggestedReply}
              onChange={(e) => setSuggestedReply(e.target.value)}
              rows={5}
              className="w-full bg-[#191A19] border border-[#353B35] focus:border-[#174B35] rounded p-2.5 text-xs text-[#D5D9D3] focus:outline-none leading-relaxed"
            />
          ) : (
            <div className="bg-[#191A19] border border-[#353B35] rounded p-2.5 text-xs text-[#D5D9D3] leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
              {suggestedReply || 'Drafting suggested reply based on customer context...'}
            </div>
          )}

          {/* Send Reply Action Button */}
          <button
            onClick={handleSendReply}
            disabled={!suggestedReply.trim() || isLoading}
            className="w-full py-2 px-3 rounded bg-[#174B35] hover:bg-[#1F6246] text-[#D5D9D3] text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send Reply</span>
          </button>
        </div>

        {/* D. Full Analysis (Expandable Section - Collapsed by Default) */}
        <div className="border border-[#353B35] rounded bg-[#191A19] overflow-hidden">
          <button
            onClick={() => setShowFullAnalysis(!showFullAnalysis)}
            className="w-full px-3 py-2 text-left text-xs font-medium text-[#929A91] hover:text-[#D5D9D3] flex items-center justify-between bg-[#191A19] hover:bg-[#242724] transition-colors"
          >
            <span>Full Analysis & Policy Context</span>
            {showFullAnalysis ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {showFullAnalysis && (
            <div className="p-3 border-t border-[#353B35] space-y-2.5 text-xs text-[#929A91] animate-fadeIn">
              <div>
                <span className="text-[10px] uppercase font-semibold text-[#687267] block">Detailed Context</span>
                <p className="text-[#D5D9D3] text-[11px] leading-relaxed mt-0.5">
                  {analysis?.issueDescription || 'No extended notes.'}
                </p>
              </div>

              <div>
                <span className="text-[10px] uppercase font-semibold text-[#687267] block">Applied Policies</span>
                <div className="space-y-1 mt-1">
                  {policyRefs.map((pol, i) => (
                    <div key={i} className="flex items-center space-x-1.5 text-[11px] text-[#D5D9D3]">
                      <ShieldCheck className="w-3 h-3 text-[#174B35] shrink-0" />
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

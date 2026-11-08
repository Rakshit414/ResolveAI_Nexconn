import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Bot, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  Send, 
  Edit3, 
  FileText, 
  ShieldCheck, 
  HelpCircle,
  ThumbsUp,
  SlidersHorizontal
} from 'lucide-react';
import { analyzeConversation, summarizeConversation, getSuggestedReply } from '../services/api';

export default function AICopilotPanel({
  ticket,
  messages,
  onApproveAndSend,
  onOpenPolicies,
}) {
  const [analysis, setAnalysis] = useState(null);
  const [summary, setSummary] = useState(null);
  const [suggestedReply, setSuggestedReply] = useState('');
  const [isEditingReply, setIsEditingReply] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [policyRefs, setPolicyRefs] = useState([]);
  const [aiSource, setAiSource] = useState('gemini');

  // Trigger AI analysis when ticket or messages change
  useEffect(() => {
    if (!ticket) return;

    // Use initial ticket metadata if available
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

    // Call live AI endpoints
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

      // Concurrent AI calls for analysis, summary, and suggestion
      const [analysisRes, summaryRes, replyRes] = await Promise.allSettled([
        analyzeConversation(payload),
        summarizeConversation(payload),
        getSuggestedReply(payload),
      ]);

      if (analysisRes.status === 'fulfilled' && analysisRes.value?.data) {
        setAnalysis(analysisRes.value.data);
        if (analysisRes.value.source) setAiSource(analysisRes.value.source);
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

  const handleApprove = () => {
    if (!suggestedReply.trim()) return;
    onApproveAndSend(suggestedReply.trim());
  };

  const getPriorityColor = (priority) => {
    switch (priority?.toLowerCase()) {
      case 'critical':
        return 'text-red-400 bg-red-500/15 border-red-500/30';
      case 'high':
        return 'text-orange-400 bg-orange-500/15 border-orange-500/30';
      case 'medium':
        return 'text-amber-300 bg-amber-500/15 border-amber-500/30';
      case 'low':
      default:
        return 'text-blue-400 bg-blue-500/15 border-blue-500/30';
    }
  };

  const getSentimentBadge = (sentiment) => {
    switch (sentiment?.toLowerCase()) {
      case 'negative':
        return 'text-red-400 bg-red-500/15 border-red-500/30';
      case 'frustrated':
        return 'text-orange-400 bg-orange-500/15 border-orange-500/30';
      case 'positive':
        return 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30';
      case 'neutral':
      default:
        return 'text-slate-300 bg-slate-800 border-slate-700';
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0B1120] border-l border-slate-800 overflow-y-auto">
      {/* Copilot Header */}
      <div className="p-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60 sticky top-0 z-10 backdrop-blur-md">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-brand-indigo to-brand-violet flex items-center justify-center text-white shadow-glow-sm">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-xs text-white flex items-center space-x-1.5">
              <span>AI Copilot</span>
              <span className="text-[10px] font-normal px-1.5 py-0.2 rounded bg-brand-indigo/20 text-brand-indigo border border-brand-indigo/30">
                {aiSource === 'gemini' ? 'Gemini 1.5' : 'Policy Engine'}
              </span>
            </h3>
            <p className="text-[10px] text-slate-400">Real-time context & assistance</p>
          </div>
        </div>

        <button
          onClick={handleRunAICopilot}
          disabled={isLoading}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-750 transition-colors"
          title="Refresh AI Analysis"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-brand-indigo' : ''}`} />
        </button>
      </div>

      <div className="p-4 space-y-4 flex-1">
        {/* Card 1: Issue Classification */}
        <div className="bg-slate-900/80 rounded-xl p-3.5 border border-slate-800 shadow-sm space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
              <Bot className="w-3.5 h-3.5 text-brand-indigo" />
              <span>Issue Classification</span>
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-850">
              <span className="text-[10px] text-slate-500 uppercase font-semibold block">Category</span>
              <span className="font-semibold text-slate-200 truncate block mt-0.5">
                {analysis?.category || 'General Inquiry'}
              </span>
            </div>

            <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-850">
              <span className="text-[10px] text-slate-500 uppercase font-semibold block">Priority</span>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border inline-block mt-0.5 ${getPriorityColor(analysis?.priority)}`}>
                {analysis?.priority || 'Medium'}
              </span>
            </div>

            <div className="col-span-2 p-2 rounded-lg bg-slate-950/80 border border-slate-850 flex items-center justify-between">
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Customer Sentiment</span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${getSentimentBadge(analysis?.sentiment)}`}>
                {analysis?.sentiment || 'Neutral'}
              </span>
            </div>
          </div>

          {analysis?.issueDescription && (
            <p className="text-[11px] text-slate-300 bg-slate-950/60 p-2.5 rounded-lg border border-slate-850 leading-relaxed">
              {analysis.issueDescription}
            </p>
          )}
        </div>

        {/* Card 2: AI Conversation Summary */}
        <div className="bg-slate-900/80 rounded-xl p-3.5 border border-slate-800 shadow-sm space-y-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
            <FileText className="w-3.5 h-3.5 text-brand-indigo" />
            <span>Structured Summary</span>
          </span>

          <div className="space-y-2 text-xs">
            <div className="border-l-2 border-brand-indigo pl-2 py-0.5">
              <strong className="text-slate-400 text-[10px] uppercase block font-semibold">What Happened</strong>
              <p className="text-slate-200 text-[11px] leading-relaxed">
                {summary?.whatHappened || 'Analyzing initial customer message...'}
              </p>
            </div>

            <div className="border-l-2 border-amber-400 pl-2 py-0.5">
              <strong className="text-slate-400 text-[10px] uppercase block font-semibold">Customer Needs</strong>
              <p className="text-slate-200 text-[11px] leading-relaxed">
                {summary?.customerNeeds || 'Awaiting customer specifications.'}
              </p>
            </div>

            <div className="border-l-2 border-purple-400 pl-2 py-0.5">
              <strong className="text-slate-400 text-[10px] uppercase block font-semibold">Pending Action</strong>
              <p className="text-slate-200 text-[11px] leading-relaxed">
                {summary?.pendingAction || 'Agent review required.'}
              </p>
            </div>
          </div>
        </div>

        {/* Card 3: Context-Aware Suggested Reply */}
        <div className="bg-slate-900/80 rounded-xl p-3.5 border border-slate-800 shadow-sm space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>Suggested Response</span>
            </span>

            <button
              onClick={() => setIsEditingReply(!isEditingReply)}
              className="text-[11px] text-brand-indigo hover:text-white flex items-center space-x-1 font-medium transition-colors"
            >
              <Edit3 className="w-3 h-3" />
              <span>{isEditingReply ? 'Done' : 'Edit'}</span>
            </button>
          </div>

          {/* Business Policy Checklist Badges */}
          <div className="flex flex-wrap gap-1.5">
            {policyRefs.map((pol, i) => (
              <span
                key={i}
                className="text-[10px] bg-brand-indigo/15 text-indigo-300 border border-brand-indigo/30 px-2 py-0.5 rounded-full flex items-center space-x-1"
              >
                <ShieldCheck className="w-3 h-3 text-brand-indigo" />
                <span className="truncate max-w-[200px]">{pol}</span>
              </span>
            ))}
          </div>

          {/* Editable Suggested Response Text */}
          {isEditingReply ? (
            <textarea
              value={suggestedReply}
              onChange={(e) => setSuggestedReply(e.target.value)}
              rows={5}
              className="w-full bg-slate-950 border border-brand-indigo/60 rounded-xl p-3 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-indigo leading-relaxed"
            />
          ) : (
            <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-850 text-xs text-slate-200 leading-relaxed max-h-44 overflow-y-auto whitespace-pre-wrap">
              {suggestedReply || 'Generating context-aware suggestion...'}
            </div>
          )}

          {/* Primary Action Button: Approve and Send */}
          <div className="pt-1">
            <button
              onClick={handleApprove}
              disabled={!suggestedReply.trim() || isLoading}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-brand-indigo to-brand-violet hover:from-brand-blue hover:to-brand-indigo text-white text-xs font-semibold flex items-center justify-center space-x-2 shadow-glow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Approve and Send to Customer</span>
            </button>
          </div>

          <div className="text-[10px] text-slate-500 text-center flex items-center justify-center space-x-1 pt-1">
            <span>Human-in-the-loop: Agent verifies message before sending.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

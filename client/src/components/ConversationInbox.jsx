import React from 'react';
import { 
  Search, 
  Flame, 
  AlertTriangle, 
  Clock, 
  CheckCircle2, 
  UserCheck, 
  Tag
} from 'lucide-react';

export default function ConversationInbox({
  tickets,
  selectedTicket,
  onSelectTicket,
  activeFilter,
  onSelectFilter,
  searchQuery,
  onSearchChange,
}) {
  // Filter tabs
  const filters = [
    { id: 'All', label: 'All' },
    { id: 'High Priority', label: 'High Priority', icon: Flame },
    { id: 'Human Assistance Requested', label: 'Human Requested', icon: UserCheck },
    { id: 'Resolved', label: 'Resolved', icon: CheckCircle2 },
  ];

  // Helper for priority styling
  const getPriorityBadge = (priority) => {
    switch (priority?.toLowerCase()) {
      case 'critical':
        return 'bg-red-500/15 text-red-400 border-red-500/30';
      case 'high':
        return 'bg-orange-500/15 text-orange-400 border-orange-500/30';
      case 'medium':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'low':
      default:
        return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    }
  };

  // Helper for sentiment indicator
  const getSentimentDot = (sentiment) => {
    switch (sentiment?.toLowerCase()) {
      case 'negative':
        return 'bg-red-500';
      case 'frustrated':
        return 'bg-orange-500';
      case 'positive':
        return 'bg-emerald-500';
      case 'neutral':
      default:
        return 'bg-slate-400';
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0B1120] border-r border-slate-800">
      {/* Inbox Search Bar */}
      <div className="p-3 border-b border-slate-800">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search tickets, customers, orders..."
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-brand-indigo transition-colors"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center space-x-1 mt-2.5 overflow-x-auto no-scrollbar">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => onSelectFilter(f.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-all ${
                activeFilter === f.id
                  ? 'bg-brand-indigo text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Ticket List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-850/80">
        {tickets.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-xs">
            No conversations match your filter criteria.
          </div>
        ) : (
          tickets.map((t) => {
            const isSelected = selectedTicket?.id === t.id;
            return (
              <button
                key={t.id}
                onClick={() => onSelectTicket(t)}
                className={`w-full text-left p-3.5 transition-all flex items-start space-x-3 ${
                  isSelected
                    ? 'bg-slate-850/90 border-l-4 border-brand-indigo'
                    : 'hover:bg-slate-850/40'
                }`}
              >
                <div className="relative shrink-0">
                  <img
                    src={t.customer?.avatar}
                    alt={t.customer?.name}
                    className="w-9 h-9 rounded-full object-cover border border-slate-700"
                  />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-[#0B1120] ${getSentimentDot(
                      t.sentiment
                    )}`}
                    title={`Customer Sentiment: ${t.sentiment}`}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-white truncate">
                      {t.customer?.name}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {t.orderId}
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-300 font-medium truncate mt-0.5">
                    {t.customer?.order?.reportedIssue || t.category}
                  </div>

                  <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                    {t.customer?.order?.initialMessage}
                  </p>

                  {/* Badges */}
                  <div className="flex items-center space-x-1.5 mt-2">
                    <span
                      className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border ${getPriorityBadge(
                        t.priority
                      )}`}
                    >
                      {t.priority}
                    </span>

                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-750">
                      {t.category}
                    </span>

                    {t.humanRequested && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center space-x-1">
                        <UserCheck className="w-2.5 h-2.5" />
                        <span>Handoff</span>
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

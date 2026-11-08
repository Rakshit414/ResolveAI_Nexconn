import React from 'react';
import { Search } from 'lucide-react';

export default function ConversationInbox({
  tickets,
  selectedTicket,
  onSelectTicket,
  activeFilter,
  onSelectFilter,
  searchQuery,
  onSearchChange,
}) {
  const filters = [
    { id: 'All', label: 'All' },
    { id: 'High Priority', label: 'High Priority' },
    { id: 'Human Requested', label: 'Human Requested' },
    { id: 'Resolved', label: 'Resolved' },
  ];

  // Minimal priority indicator (Crimson Red for urgent/critical/high)
  const isUrgent = (priority) => {
    const p = priority?.toLowerCase();
    return p === 'critical' || p === 'high';
  };

  // Status text formatting
  const formatStatus = (status) => {
    if (status === 'Human Assistance Requested' || status === 'Human Requested') {
      return 'Human Requested';
    }
    if (status === 'In Progress' || status === 'Human Agent Active') {
      return 'Human Agent Active';
    }
    if (status === 'Open' || status === 'AI Handling') {
      return 'AI Handling';
    }
    if (status === 'Resolved') {
      return 'Resolved';
    }
    return status || 'AI Handling';
  };

  return (
    <div className="flex flex-col h-full bg-[#111311] border-r border-[#353B35]">
      {/* Search Input */}
      <div className="p-3 border-b border-[#353B35] space-y-2.5">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#929A91] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search conversations..."
            className="w-full bg-[#191A19] border border-[#353B35] rounded pl-8 pr-3 py-1.5 text-xs text-[#D5D9D3] placeholder-[#929A91] focus:outline-none focus:border-[#174B35] transition-colors"
          />
        </div>

        {/* Minimal Filter Tabs */}
        <div className="flex items-center space-x-1 overflow-x-auto no-scrollbar">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => onSelectFilter(f.id)}
              className={`px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors ${
                activeFilter === f.id
                  ? 'bg-[#174B35] text-[#D5D9D3]'
                  : 'text-[#929A91] hover:text-[#D5D9D3] hover:bg-[#1E211E]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#353B35]/40">
        {tickets.length === 0 ? (
          <div className="p-6 text-center text-[#929A91] text-xs">
            No conversations match this filter.
          </div>
        ) : (
          tickets.map((t) => {
            const isSelected = selectedTicket?.id === t.id;
            const urgent = isUrgent(t.priority);
            const statusLabel = formatStatus(t.status);

            return (
              <button
                key={t.id}
                onClick={() => onSelectTicket(t)}
                className={`w-full text-left p-3 transition-colors flex items-start space-x-2.5 border-l-2 ${
                  isSelected
                    ? 'bg-[#191A19] border-l-[#174B35]'
                    : 'border-l-transparent hover:bg-[#191A19]/50'
                }`}
              >
                {/* Subtle Customer Avatar */}
                <div className="relative shrink-0 mt-0.5">
                  <img
                    src={t.customer?.avatar}
                    alt={t.customer?.name}
                    className="w-7 h-7 rounded-full object-cover border border-[#353B35] grayscale"
                  />
                  {/* Minimal priority dot if urgent */}
                  {urgent && (
                    <span 
                      className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#A51F32]" 
                      title={`${t.priority} Priority`}
                    />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#D5D9D3] truncate">
                      {t.customer?.name}
                    </span>
                    <span className="text-[10px] text-[#929A91] shrink-0 font-mono">
                      {new Date(t.lastUpdated || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <p className="text-[11px] text-[#929A91] truncate mt-0.5 leading-snug">
                    {t.customer?.order?.initialMessage || t.customer?.order?.reportedIssue}
                  </p>

                  {/* Clean minimal metadata line */}
                  <div className="flex items-center justify-between mt-1.5 text-[10px]">
                    <span className="text-[#929A91] font-mono">
                      {t.orderId}
                    </span>

                    <span className={`font-medium ${
                      statusLabel === 'Human Requested'
                        ? 'text-[#A51F32]'
                        : statusLabel === 'Resolved'
                        ? 'text-[#174B35]'
                        : statusLabel === 'Human Agent Active'
                        ? 'text-[#D5D9D3]'
                        : 'text-[#929A91]'
                    }`}>
                      {statusLabel}
                    </span>
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

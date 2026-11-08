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

  const isUrgent = (priority) => {
    const p = priority?.toLowerCase();
    return p === 'critical' || p === 'high';
  };

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
    <div className="flex flex-col h-full bg-[#0E0E0E] border-r border-[#222222]">
      {/* Search Input */}
      <div className="p-3 border-b border-[#222222] space-y-2.5">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#8A8A8A] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search conversations..."
            className="w-full bg-[#161616] border border-[#222222] rounded pl-8 pr-3 py-1.5 text-xs text-[#FFFFFF] placeholder-[#8A8A8A] focus:outline-none focus:border-[#7CFF00] transition-colors"
          />
        </div>

        {/* Minimal Filter Tabs */}
        <div className="flex items-center space-x-1 overflow-x-auto no-scrollbar">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => onSelectFilter(f.id)}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold whitespace-nowrap transition-all ${
                activeFilter === f.id
                  ? 'bg-[#7CFF00] text-[#090909] shadow-neon-sm'
                  : 'text-[#8A8A8A] hover:text-[#FFFFFF] hover:bg-[#1A1A1A]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#1A1A1A]">
        {tickets.length === 0 ? (
          <div className="p-6 text-center text-[#8A8A8A] text-xs">
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
                    ? 'bg-[#161616] border-l-[#7CFF00]'
                    : 'border-l-transparent hover:bg-[#141414]'
                }`}
              >
                {/* Customer Avatar with subtle dot */}
                <div className="relative shrink-0 mt-0.5">
                  <img
                    src={t.customer?.avatar}
                    alt={t.customer?.name}
                    className="w-7 h-7 rounded-full object-cover border border-[#282828] grayscale"
                  />
                  {urgent && (
                    <span 
                      className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#FF334B]" 
                      title={`${t.priority} Priority`}
                    />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#FFFFFF] truncate">
                      {t.customer?.name}
                    </span>
                    <span className="text-[10px] text-[#8A8A8A] shrink-0 font-mono">
                      {new Date(t.lastUpdated || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <p className="text-[11px] text-[#8A8A8A] truncate mt-0.5 leading-snug">
                    {t.customer?.order?.initialMessage || t.customer?.order?.reportedIssue}
                  </p>

                  {/* Clean minimal metadata line */}
                  <div className="flex items-center justify-between mt-1.5 text-[10px]">
                    <span className="text-[#8A8A8A] font-mono">
                      {t.orderId}
                    </span>

                    <span className={`font-semibold ${
                      statusLabel === 'Human Requested'
                        ? 'text-[#FF334B]'
                        : statusLabel === 'Resolved'
                        ? 'text-[#7CFF00]'
                        : statusLabel === 'Human Agent Active'
                        ? 'text-[#FFFFFF]'
                        : 'text-[#8A8A8A]'
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

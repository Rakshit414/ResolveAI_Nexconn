import React from 'react';
import { Search, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

export default function ConversationInbox({
  tickets,
  selectedTicket,
  onSelectTicket,
  activeFilter,
  onSelectFilter,
  searchQuery,
  onSearchChange,
  isCollapsed = false,
  onToggleCollapse,
  isSplitView = false,
}) {
  const filters = [
    { id: 'All', label: 'All' },
    { id: 'High Priority', label: 'Urgent' },
    { id: 'Human Requested', label: 'Handoff' },
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
      return 'Agent Active';
    }
    if (status === 'Open' || status === 'AI Handling') {
      return 'AI Handling';
    }
    if (status === 'Resolved') {
      return 'Resolved';
    }
    return status || 'AI Handling';
  };

  // If collapsed to icon rail
  if (isCollapsed) {
    return (
      <div className="w-14 h-full bg-[#0D0D0D] border-r border-[#1A1A1A] flex flex-col items-center py-3 shrink-0">
        {/* Expand Button */}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="p-2 mb-3 rounded-lg text-[#8A8A8A] hover:text-[#FFFFFF] hover:bg-[#161616] transition-colors"
            title="Expand Inbox"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        )}

        {/* Collapsed Icon List */}
        <div className="flex-1 w-full space-y-2.5 overflow-y-auto no-scrollbar flex flex-col items-center">
          {tickets.map((t) => {
            const isSelected = selectedTicket?.id === t.id;
            const urgent = isUrgent(t.priority);
            const isHandoff = t.humanRequested || t.status === 'Human Requested';

            return (
              <button
                key={t.id}
                onClick={() => onSelectTicket(t)}
                className={`relative p-2 rounded-xl transition-all ${
                  isSelected
                    ? 'bg-[#181818] ring-1.5 ring-[#7CFF00]'
                    : 'hover:bg-[#141414]'
                }`}
                title={`${t.customer?.name} (${t.orderId}) - ${t.status}`}
              >
                <img
                  src={t.customer?.avatar}
                  alt={t.customer?.name}
                  className="w-7 h-7 rounded-full object-cover border border-[#262626] grayscale"
                />
                {/* Status Dot */}
                {urgent || isHandoff ? (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#FF334B] shadow-neon-sm" />
                ) : t.status === 'Resolved' ? (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#7CFF00]" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Expanded Inbox Rail (~260px on desktop, full width on mobile)
  const railWidth = isSplitView ? 'w-full md:w-[230px]' : 'w-full md:w-[260px]';

  return (
    <div className={`${railWidth} h-full bg-[#0D0D0D] border-r border-[#1A1A1A] flex flex-col shrink-0 overflow-hidden`}>
      {/* Top Header & Search */}
      <div className="p-3.5 border-b border-[#1A1A1A] space-y-2.5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-xs text-[#FFFFFF]">Inbox</span>
            <span className="text-[10px] text-[#7CFF00] font-mono px-1.5 py-0.2 bg-[#7CFF00]/10 rounded border border-[#7CFF00]/30 font-semibold">
              {tickets.length}
            </span>
          </div>

          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="p-1 rounded-lg text-[#8A8A8A] hover:text-[#FFFFFF] hover:bg-[#181818] transition-colors"
              title="Collapse to icon rail"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#8A8A8A] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search tickets..."
            className="w-full bg-[#141414] border border-[#222222] rounded-xl pl-8 pr-3 py-1.5 text-xs text-[#FFFFFF] placeholder-[#666666] focus:outline-none focus:border-[#7CFF00] transition-colors"
          />
        </div>

        {/* Compact Filter Tabs */}
        <div className="flex items-center space-x-1 overflow-x-auto no-scrollbar">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => onSelectFilter(f.id)}
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap transition-all ${
                activeFilter === f.id
                  ? 'bg-[#7CFF00] text-[#090909] shadow-neon-sm font-bold'
                  : 'text-[#8A8A8A] hover:text-[#FFFFFF] hover:bg-[#181818]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Ticket List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#141414]">
        {tickets.length === 0 ? (
          <div className="p-5 text-center text-[#8A8A8A] text-xs">
            No tickets match.
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
                className={`w-full text-left p-3.5 transition-colors flex items-start space-x-3 border-l-2 ${
                  isSelected
                    ? 'bg-[#141414] border-l-[#7CFF00]'
                    : 'border-l-transparent hover:bg-[#111111]'
                }`}
              >
                {/* Avatar with status indicator */}
                <div className="relative shrink-0 mt-0.5">
                  <img
                    src={t.customer?.avatar}
                    alt={t.customer?.name}
                    className="w-8 h-8 rounded-full object-cover border border-[#282828] grayscale"
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
                    <span className="font-bold text-[#FFFFFF] truncate text-[13px]">
                      {t.customer?.name}
                    </span>
                    <span className="text-[10px] text-[#666666] shrink-0 font-mono">
                      {new Date(t.lastUpdated || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <p className="text-xs text-[#8A8A8A] truncate mt-0.5 leading-snug">
                    {t.customer?.order?.initialMessage || t.customer?.order?.reportedIssue}
                  </p>

                  <div className="flex items-center justify-between mt-1 text-[11px]">
                    <span className="text-[#666666] font-mono truncate">
                      {t.orderId}
                    </span>

                    <span className={`font-semibold shrink-0 ${
                      statusLabel === 'Human Requested'
                        ? 'text-[#FF334B]'
                        : statusLabel === 'Resolved'
                        ? 'text-[#7CFF00]'
                        : statusLabel === 'Agent Active'
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
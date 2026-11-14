import React from 'react';
import {
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Inbox,
  UserCheck,
  Users,
  AlertCircle,
  Clock,
  ShieldCheck,
  UserPlus,
  Sparkles,
  ArrowRightLeft
} from 'lucide-react';

export default function ConversationInbox({
  tickets = [],
  unassignedTickets = [],
  teamOverview = null,
  agentRoster = [],
  selectedTicket = null,
  onSelectTicket,
  onClaimTicket = null,
  currentInboxView = 'my_tickets', // 'my_tickets' | 'unassigned' | 'team_overview'
  onSelectInboxView = null,
  activeFilter = 'All',
  onSelectFilter,
  searchQuery = '',
  onSearchChange,
  isCollapsed = false,
  onToggleCollapse,
  isSplitView = false,
  onClose,
  currentUserRole = 'agent',
  onReassignTicket = null
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
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="p-2 mb-3 rounded-lg text-[#8A8A8A] hover:text-[#FFFFFF] hover:bg-[#161616] transition-colors"
            title="Expand Inbox"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        )}

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

  // Expanded Inbox Rail (~280px on desktop, full width on mobile)
  const railWidth = isSplitView ? 'w-full md:w-[260px]' : 'w-full md:w-[280px]';

  return (
    <div className={`${railWidth} h-full bg-[#0D0D0D] border-r border-[#1A1A1A] flex flex-col shrink-0 overflow-hidden`}>
      {/* 1. Header with Collapse / Close */}
      <div className="p-3 border-b border-[#1A1A1A] flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <span className="font-bold text-xs text-[#FFFFFF]">Shared Inbox</span>
        </div>

        <div className="flex items-center space-x-1">
          {onToggleCollapse && !onClose && (
            <button
              onClick={onToggleCollapse}
              className="p-1 rounded-lg text-[#8A8A8A] hover:text-[#FFFFFF] hover:bg-[#181818] transition-colors"
              title="Collapse to icon rail"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
          {onClose && (
            <button
              id="btn-close-inbox-drawer"
              onClick={onClose}
              className="p-1 rounded-lg text-[#8A8A8A] hover:text-[#FFFFFF] hover:bg-[#181818] transition-colors"
              title="Close Inbox"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Primary View Switcher: My Tickets | Unassigned | Team Overview */}
      <div className="p-2 bg-[#0F0F0F] border-b border-[#1A1A1A] grid grid-cols-3 gap-1 shrink-0">
        <button
          onClick={() => onSelectInboxView && onSelectInboxView('my_tickets')}
          className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all flex items-center justify-center space-x-1 ${
            currentInboxView === 'my_tickets'
              ? 'bg-[#181818] text-[#7CFF00] border border-[#7CFF00]/40 shadow-sm'
              : 'text-[#8A8A8A] hover:text-white'
          }`}
          title="Tickets assigned to you"
        >
          <Inbox className="w-3 h-3" />
          <span>My Tickets</span>
          <span className="text-[10px] font-mono px-1 rounded bg-black/40 text-[#7CFF00]">
            {tickets.length}
          </span>
        </button>

        <button
          onClick={() => onSelectInboxView && onSelectInboxView('unassigned')}
          className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all flex items-center justify-center space-x-1 ${
            currentInboxView === 'unassigned'
              ? 'bg-[#181818] text-[#38BDF8] border border-[#38BDF8]/40 shadow-sm'
              : 'text-[#8A8A8A] hover:text-white'
          }`}
          title="Unassigned queue (Masked PII)"
        >
          <AlertCircle className="w-3 h-3 text-[#38BDF8]" />
          <span>Queue</span>
          <span className="text-[10px] font-mono px-1 rounded bg-black/40 text-[#38BDF8]">
            {unassignedTickets.length}
          </span>
        </button>

        <button
          onClick={() => onSelectInboxView && onSelectInboxView('team_overview')}
          className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all flex items-center justify-center space-x-1 ${
            currentInboxView === 'team_overview'
              ? 'bg-[#181818] text-[#F59E0B] border border-[#F59E0B]/40 shadow-sm'
              : 'text-[#8A8A8A] hover:text-white'
          }`}
          title="Team Overview & Live Agent Roster"
        >
          <Users className="w-3 h-3 text-[#F59E0B]" />
          <span>Team</span>
        </button>
      </div>

      {/* 3. Search & Filter Bar (Only shown for ticket views) */}
      {currentInboxView !== 'team_overview' && (
        <div className="p-3 border-b border-[#1A1A1A] space-y-2 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#8A8A8A] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search by customer, order, or issue..."
              className="w-full bg-[#141414] border border-[#222222] rounded-xl pl-8 pr-3 py-1.5 text-xs text-[#FFFFFF] placeholder-[#666666] focus:outline-none focus:border-[#7CFF00] transition-colors"
            />
          </div>

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
      )}

      {/* 4. Body Content Depending on Selected View */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#141414]">
        {/* VIEW A: MY TICKETS */}
        {currentInboxView === 'my_tickets' && (
          tickets.length === 0 ? (
            <div className="p-6 text-center text-[#8A8A8A] text-xs space-y-1">
              <Inbox className="w-6 h-6 mx-auto text-[#333333]" />
              <p>No assigned tickets.</p>
              <button
                onClick={() => onSelectInboxView && onSelectInboxView('unassigned')}
                className="text-[#7CFF00] hover:underline block mx-auto text-[11px]"
              >
                Check unassigned queue
              </button>
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
                      {t.customer?.order?.initialMessage || t.summary || t.customer?.order?.reportedIssue}
                    </p>

                    <div className="flex items-center justify-between mt-1 text-[11px]">
                      <span className="text-[#666666] font-mono truncate">
                        #{t.orderId}
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
          )
        )}

        {/* VIEW B: UNASSIGNED QUEUE (WITH MASKED CUSTOMER PII) */}
        {currentInboxView === 'unassigned' && (
          unassignedTickets.length === 0 ? (
            <div className="p-6 text-center text-[#8A8A8A] text-xs space-y-1">
              <ShieldCheck className="w-6 h-6 mx-auto text-[#7CFF00]" />
              <p>Unassigned queue is clear!</p>
              <span className="text-[11px] text-[#555555]">All customer inquiries have been routed.</span>
            </div>
          ) : (
            unassignedTickets.map((t) => {
              const isSelected = selectedTicket?.id === t.id;
              const urgent = isUrgent(t.priority);

              return (
                <div
                  key={t.id}
                  onClick={() => onSelectTicket(t)}
                  className={`p-3.5 transition-colors flex items-start space-x-3 border-l-2 cursor-pointer ${
                    isSelected
                      ? 'bg-[#141414] border-l-[#38BDF8]'
                      : 'border-l-transparent hover:bg-[#111111]'
                  }`}
                >
                  <div className="relative shrink-0 mt-0.5">
                    <div className="w-8 h-8 rounded-full bg-[#1F2937] border border-[#374151] flex items-center justify-center text-[#9CA3AF] font-bold text-xs">
                      {t.customer?.name ? t.customer.name.charAt(0) : '?'}
                    </div>
                    {urgent && (
                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#FF334B]" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-1.5 truncate">
                        <span className="font-semibold text-[#FFFFFF] truncate">
                          {t.customer?.name || 'Customer'}
                        </span>
                        <span className="text-[9px] px-1 py-0.2 rounded bg-[#38BDF8]/10 text-[#38BDF8] border border-[#38BDF8]/30 font-mono">
                          Masked PII
                        </span>
                      </div>
                      <span className="text-[10px] text-[#FF334B] font-semibold">
                        {t.priority}
                      </span>
                    </div>

                    <p className="text-[11px] text-[#8A8A8A] truncate">
                      {t.summary || t.issueDescription || 'Support inquiry'}
                    </p>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] text-[#555555] font-mono">
                        Lang: {t.customer_language || t.customerLanguage || 'en-US'}
                      </span>
                      {onClaimTicket && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onClaimTicket(t.id);
                          }}
                          className="px-2 py-0.5 rounded bg-[#7CFF00] hover:bg-[#8EFF1F] text-[#090909] text-[10px] font-bold transition-all shadow-neon-sm flex items-center space-x-1"
                        >
                          <UserPlus className="w-2.5 h-2.5" />
                          <span>Claim</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )
        )}

        {/* VIEW C: TEAM OVERVIEW & LIVE AGENT ROSTER */}
        {currentInboxView === 'team_overview' && (
          <div className="p-3.5 space-y-4">
            {/* Team Metrics Summary */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-[#141414] p-2.5 rounded-xl border border-[#222222]">
                <span className="text-[10px] uppercase font-bold text-[#666666] block">Unassigned</span>
                <span className="text-base font-bold text-[#38BDF8]">
                  {teamOverview?.metrics?.unassignedCount ?? unassignedTickets.length}
                </span>
              </div>
              <div className="bg-[#141414] p-2.5 rounded-xl border border-[#222222]">
                <span className="text-[10px] uppercase font-bold text-[#666666] block">Active Assigned</span>
                <span className="text-base font-bold text-[#7CFF00]">
                  {teamOverview?.metrics?.activeAssignedCount ?? tickets.length}
                </span>
              </div>
            </div>

            {/* Live Agent Roster */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#8A8A8A]">
                  Agent Roster & Workload
                </span>
                <span className="text-[10px] text-[#7CFF00] font-mono">
                  {agentRoster.length} Agents
                </span>
              </div>

              {agentRoster.length === 0 ? (
                <div className="text-center py-4 text-xs text-[#666666]">
                  Loading agent roster...
                </div>
              ) : (
                agentRoster.map((agent) => {
                  const isAvailable = agent.effectiveStatus === 'Available' || agent.configuredStatus === 'Available';
                  const isAtCapacity = agent.effectiveStatus === 'At Capacity' || (agent.activeTicketCount >= agent.maxConcurrentTickets && isAvailable);

                  return (
                    <div
                      key={agent.userId}
                      className="p-2.5 rounded-xl bg-[#141414] border border-[#222222] space-y-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 truncate">
                          <span className={`w-2 h-2 rounded-full ${
                            isAtCapacity
                              ? 'bg-[#F59E0B] shadow-neon-sm'
                              : isAvailable
                              ? 'bg-[#7CFF00]'
                              : 'bg-[#666666]'
                          }`} />
                          <span className="font-semibold text-white truncate">
                            {agent.displayName}
                          </span>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-semibold ${
                          isAtCapacity
                            ? 'bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/30'
                            : isAvailable
                            ? 'bg-[#7CFF00]/10 text-[#7CFF00] border border-[#7CFF00]/30'
                            : 'bg-[#222222] text-[#888888]'
                        }`}>
                          {agent.effectiveStatus || agent.configuredStatus}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-[#8A8A8A]">
                        <span>Workload: <strong className={isAtCapacity ? "text-[#F59E0B]" : "text-white"}>{agent.activeTicketCount}/{agent.maxConcurrentTickets}</strong></span>
                        <span className="text-[10px] font-mono text-[#666666]">
                          {agent.skills?.slice(0, 2).join(', ')}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

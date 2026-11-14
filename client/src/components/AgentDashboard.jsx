import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DEMO_CUSTOMERS, DEMO_AGENT } from '../data/demoData';
import {
  getTickets,
  getTicket,
  takeOverTicket,
  resolveTicket,
  createAgentSession,
  refreshAgentHeartbeat,
  getAgentProfile,
  updateAgentStatus,
  getUnassignedTickets,
  getMyTickets,
  getTeamOverview,
  getAgentRoster,
  claimOrReassignTicket,
  transferTicket,
  resolveTicketWithCapacity
} from '../services/api';
import nexconnService from '../services/nexconnService';
import ConversationInbox from './ConversationInbox';
import ChatWindow from './ChatWindow';
import AICopilotPanel from './AICopilotPanel';
import KnowledgeHubDrawer from './KnowledgeHubDrawer';
import {
  BookOpen,
  ShieldCheck,
  Sparkles,
  ChevronDown,
  AlertCircle,
  RefreshCw,
  Check,
  UserCheck
} from 'lucide-react';

export default function AgentDashboard({
  selectedTicketId,
  onSelectTicketId,
  onOpenPolicies,
  isSplitView = false,
}) {
  const [tickets, setTickets] = useState([]);
  const [unassignedTickets, setUnassignedTickets] = useState([]);
  const [teamOverview, setTeamOverview] = useState(null);
  const [agentRoster, setAgentRoster] = useState([]);
  const [currentInboxView, setCurrentInboxView] = useState('my_tickets'); // 'my_tickets' | 'unassigned' | 'team_overview'

  const [selectedTicket, setSelectedTicket] = useState(null);
  const [messagesMap, setMessagesMap] = useState({});
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Agent Profile & Session State
  const [configuredStatus, setConfiguredStatus] = useState('Available');
  const [effectiveStatus, setEffectiveStatus] = useState('Available');
  const [activeWorkload, setActiveWorkload] = useState(0);
  const [maxCapacity, setMaxCapacity] = useState(3);
  const [agentRole, setAgentRole] = useState('agent'); // 'agent' | 'support_lead' | 'admin'
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [isKnowledgeHubOpen, setIsKnowledgeHubOpen] = useState(false);

  // Split View & Drawer Controls
  const [splitPanel, setSplitPanel] = useState('none');
  const [isCopilotStandaloneOpen, setIsCopilotStandaloneOpen] = useState(false);
  const [isInboxCollapsed, setIsInboxCollapsed] = useState(false);
  const [mobileTab, setMobileTab] = useState('chat'); // 'inbox' | 'chat' | 'copilot'
  const [noticeMessage, setNoticeMessage] = useState(null);

  const [stats, setStats] = useState({
    total: 3,
    urgent: 2,
    humanHandoffs: 2,
    resolved: 0,
  });

  const subscriptionsRef = useRef([]);
  const heartbeatTimerRef = useRef(null);

  // Recalculate effective status based on active ticket count and configured status
  const calculateEffectiveStatus = (configured, activeCount, maxCap) => {
    if (configured === 'Offline' || configured === 'Away' || configured === 'Busy') {
      return configured;
    }
    if (activeCount >= maxCap) {
      return 'At Capacity';
    }
    return 'Available';
  };

  // 1. Establish Agent Session & Periodic Heartbeat on Mount
  useEffect(() => {
    let isMounted = true;

    async function initAgentSession() {
      try {
        const sessionRes = await createAgentSession('user_sarah_lin', 'brand_novacart');
        if (isMounted && sessionRes?.profile) {
          const prof = sessionRes.profile;
          setConfiguredStatus(prof.configuredStatus || 'Available');
          setMaxCapacity(prof.maxConcurrentTickets || 3);
          setActiveWorkload(prof.activeTicketCount || 0);
          setEffectiveStatus(calculateEffectiveStatus(
            prof.configuredStatus || 'Available',
            prof.activeTicketCount || 0,
            prof.maxConcurrentTickets || 3
          ));
        }
      } catch (err) {
        console.warn('[AgentDashboard session note]:', err.message);
      }
    }

    initAgentSession();

    // Heartbeat every 20 seconds to keep session and availability state fresh
    heartbeatTimerRef.current = setInterval(() => {
      refreshAgentHeartbeat().catch(() => {});
    }, 20000);

    return () => {
      isMounted = false;
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
    };
  }, []);

  // 2. Fetch Remote Tickets, Roster & Unassigned Queue
  const refreshData = useCallback(async () => {
    try {
      const [rosterRes, unassignedRes, overviewRes] = await Promise.allSettled([
        getAgentRoster(),
        getUnassignedTickets(),
        getTeamOverview()
      ]);

      if (rosterRes.status === 'fulfilled' && rosterRes.value?.roster) {
        setAgentRoster(rosterRes.value.roster);
        const sarah = rosterRes.value.roster.find(a => a.userId === 'user_sarah_lin');
        if (sarah) {
          setConfiguredStatus(sarah.configuredStatus);
          setActiveWorkload(sarah.activeTicketCount);
          setMaxCapacity(sarah.maxConcurrentTickets);
          setEffectiveStatus(sarah.effectiveStatus || calculateEffectiveStatus(sarah.configuredStatus, sarah.activeTicketCount, sarah.maxConcurrentTickets));
        }
      }

      if (unassignedRes.status === 'fulfilled' && unassignedRes.value?.tickets) {
        setUnassignedTickets(unassignedRes.value.tickets);
      }

      if (overviewRes.status === 'fulfilled' && overviewRes.value) {
        setTeamOverview(overviewRes.value);
      }
    } catch (e) {
      // Non-fatal fallback
    }
  }, []);

  // 3. Initialize tickets and Nexconn listeners
  useEffect(() => {
    nexconnService.connectUser({
      id: DEMO_AGENT.id,
      name: DEMO_AGENT.name,
      avatar: DEMO_AGENT.avatar,
      role: 'agent',
    });

    const initialTickets = DEMO_CUSTOMERS.map((c) => {
      const stored = nexconnService.getTicketStatus(c.ticket.id);
      return {
        ...c.ticket,
        status: stored?.status || c.ticket.status,
        humanRequested: stored !== null ? (stored.status === 'Human Requested') : c.ticket.humanRequested,
        channelId: c.channelId || `channel_${c.order.orderId}`,
        customer: {
          id: c.id,
          name: c.name,
          email: c.email,
          channelId: c.channelId || `channel_${c.order.orderId}`,
          avatar: c.avatar,
          order: c.order,
        },
      };
    });

    setTickets(initialTickets);

    const initialSelected =
      initialTickets.find(t => t.id === selectedTicketId) || initialTickets[0];
    setSelectedTicket(initialSelected);

    const initialMap = {};
    initialTickets.forEach((t) => {
      const channelId = t.channelId || `channel_${t.orderId}`;
      initialMap[t.id] = nexconnService.getChannelMessages(channelId);
    });
    setMessagesMap(initialMap);

    // Initial background load
    getTickets()
      .then((res) => {
        if (res?.tickets && res.tickets.length > 0) {
          setTickets((prev) =>
            prev.map((t) => {
              const remote = res.tickets.find((rt) => rt.id === t.id);
              if (remote) {
                nexconnService.setTicketStatus(t.id, remote.status, { lastUpdated: remote.lastUpdated });
                if (remote.feedback) {
                  nexconnService.setTicketFeedback(t.id, remote.feedback);
                }
                return {
                  ...t,
                  status: remote.status,
                  priority: remote.priority || t.priority,
                  category: remote.category || t.category,
                  humanRequested: remote.status === 'Human Requested' || Boolean(remote.humanRequested),
                  summary: remote.summary || t.summary,
                  suggestedReply: remote.suggestedReply || t.suggestedReply,
                  pendingAction: remote.pendingAction || t.pendingAction,
                  feedback: remote.feedback || t.feedback,
                };
              }
              return t;
            })
          );
        }
      })
      .catch(() => {});

    refreshData();

    // Nexconn subscriptions
    subscriptionsRef.current.forEach((unsub) => unsub());
    subscriptionsRef.current = [];

    initialTickets.forEach((t) => {
      const channelId = t.channelId || `channel_${t.orderId}`;
      const unsub = nexconnService.subscribe(channelId, (newMsg) => {
        // If message is marked internal note, only display to agent
        setMessagesMap((prev) => {
          const currentList = prev[t.id] || [];
          if (currentList.some((m) => m.id === newMsg.id || (m.messageId && m.messageId === newMsg.messageId))) {
            return prev;
          }
          return {
            ...prev,
            [t.id]: [...currentList, newMsg],
          };
        });

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

        if (!s && newMsg.senderRole === 'customer' && isLive && (t.status === 'Resolved' || newMsg.metadata?.isReopened)) {
          s = 'AI Handling';
        }

        if (newMsg.metadata?.feedback) {
          const fb = newMsg.metadata.feedback;
          nexconnService.setTicketFeedback(t.id, fb);
          setTickets((prev) =>
            prev.map((item) => item.id === t.id ? { ...item, feedback: fb } : item)
          );
        }

        if (s && isLive) {
          setTickets((prev) =>
            prev.map((item) =>
              item.id === t.id
                ? {
                    ...item,
                    status: s,
                    humanRequested: s === 'Human Requested',
                    lastUpdated: new Date().toISOString(),
                  }
                : item
            )
          );
          setSelectedTicket((prev) =>
            prev?.id === t.id
              ? {
                  ...prev,
                  status: s,
                  humanRequested: s === 'Human Requested',
                }
              : prev
          );
        }
      });
      subscriptionsRef.current.push(unsub);
    });

    return () => {
      subscriptionsRef.current.forEach((unsub) => unsub());
      subscriptionsRef.current = [];
    };
  }, [refreshData]);

  // Sync selected ticket prop
  useEffect(() => {
    if (selectedTicketId && tickets.length > 0) {
      const match = tickets.find((t) => t.id === selectedTicketId);
      if (match) {
        setSelectedTicket(match);
        const channelId = match.channelId || `channel_${match.orderId}`;
        setMessagesMap((prev) => ({
          ...prev,
          [match.id]: nexconnService.getChannelMessages(channelId),
        }));
      }
    }
  }, [selectedTicketId, tickets]);

  // Compute metrics
  useEffect(() => {
    const urgentCount = tickets.filter(
      (t) => t.priority === 'Critical' || t.priority === 'High'
    ).length;
    const handoffCount = tickets.filter((t) =>
      t.humanRequested || t.status === 'Human Requested' || t.status === 'Human Assistance Requested'
    ).length;
    const resolvedCount = tickets.filter((t) => t.status === 'Resolved').length;

    setStats({
      total: tickets.length,
      urgent: urgentCount,
      humanHandoffs: handoffCount,
      resolved: resolvedCount,
    });
  }, [tickets]);

  // Status Change Handler
  const handleConfiguredStatusChange = async (newStatus) => {
    setStatusDropdownOpen(false);
    setConfiguredStatus(newStatus);
    const eff = calculateEffectiveStatus(newStatus, activeWorkload, maxCapacity);
    setEffectiveStatus(eff);

    try {
      const res = await updateAgentStatus(newStatus, 'Updated via Agent Console UI');
      if (res?.profile) {
        setConfiguredStatus(res.profile.configured_status || newStatus);
        setEffectiveStatus(res.profile.effective_status || eff);
      }
      setNoticeMessage(`Status updated to ${newStatus}`);
      setTimeout(() => setNoticeMessage(null), 2500);
      refreshData();
    } catch (err) {
      console.warn('Status change error:', err.message);
    }
  };

  // Ticket Claim Handler
  const handleClaimTicket = async (ticketId) => {
    try {
      const res = await claimOrReassignTicket(ticketId);
      if (res?.success) {
        setNoticeMessage(`Ticket claimed successfully!`);
        setTimeout(() => setNoticeMessage(null), 2500);
        refreshData();
        setCurrentInboxView('my_tickets');
      }
    } catch (err) {
      setNoticeMessage(`Claim failed: ${err.message}`);
      setTimeout(() => setNoticeMessage(null), 4000);
    }
  };

  // Ticket Transfer Handler
  const handleTransferTicket = async (ticketId, transferData) => {
    const res = await transferTicket(ticketId, transferData);
    if (res?.success) {
      setNoticeMessage('Ticket transferred successfully.');
      setTimeout(() => setNoticeMessage(null), 3000);

      // Add handoff note locally to conversation history
      const channelId = selectedTicket?.channelId || `channel_${selectedTicket?.orderId}`;
      const transferNote = {
        id: `note_transfer_${Date.now()}`,
        senderName: 'Sarah Lin',
        senderRole: 'internal_note',
        isInternal: true,
        text: `Transferred ticket to agent ${transferData.toAgentId}. Handoff context: ${transferData.handoffSummaryJson?.reason || 'Reassigned'}. Notes: ${transferData.internalNotes || 'None'}`,
        timestamp: new Date().toISOString(),
        metadata: {
          type: 'TRANSFER_HANDOFF',
          isInternal: true,
          handoffSummary: transferData.handoffSummaryJson
        }
      };

      setMessagesMap(prev => ({
        ...prev,
        [ticketId]: [...(prev[ticketId] || []), transferNote]
      }));

      refreshData();
      return res;
    }
    throw new Error(res?.error || 'Transfer failed');
  };

  // Ticket Resolution Handler with capacity release
  const handleUpdateStatus = async (newStatus) => {
    if (!selectedTicket) return;

    setTickets((prev) =>
      prev.map((t) =>
        t.id === selectedTicket.id
          ? {
              ...t,
              status: newStatus,
              humanRequested: newStatus === 'Human Requested' ? true : newStatus === 'Resolved' ? false : t.humanRequested,
              lastUpdated: new Date().toISOString(),
            }
          : t
      )
    );

    setSelectedTicket((prev) =>
      prev
        ? {
            ...prev,
            status: newStatus,
            humanRequested: newStatus === 'Human Requested' ? true : newStatus === 'Resolved' ? false : prev.humanRequested,
          }
        : null
    );

    nexconnService.setTicketStatus(selectedTicket.id, newStatus);

    try {
      if (newStatus === 'Human Agent Active') {
        await takeOverTicket(selectedTicket.id).catch(console.warn);
      } else if (newStatus === 'Resolved') {
        await resolveTicketWithCapacity(selectedTicket.id).catch(console.warn);
      } else {
        await updateTicket(selectedTicket.id, { status: newStatus }).catch(console.warn);
      }
      refreshData();
    } catch (err) {
      console.warn('Backend ticket update error:', err);
    }

    // Broadcast notice over Nexconn (only for customer-facing status changes)
    try {
      const channelId = selectedTicket.channelId || `channel_${selectedTicket.orderId}`;
      const targetUserId = selectedTicket.customer?.id;
      const noticeText = newStatus === 'Human Agent Active'
        ? `Sarah Lin (Support Specialist) has joined the conversation and taken over order #${selectedTicket.orderId}.`
        : newStatus === 'Resolved'
        ? `Ticket for order #${selectedTicket.orderId} marked as resolved by Sarah Lin. Thank you for contacting NovaCart Support!`
        : `Ticket status for order #${selectedTicket.orderId} updated to: ${newStatus}`;

      await nexconnService.sendMessage({
        targetUserId,
        channelId,
        text: noticeText,
        metadata: {
          ticketId: selectedTicket.id,
          status: newStatus,
          type: 'STATUS_CHANGE',
        },
      });

      setMessagesMap((prev) => ({
        ...prev,
        [selectedTicket.id]: nexconnService.getChannelMessages(channelId),
      }));
    } catch (err) {
      console.warn('Nexconn status broadcast error:', err);
    }
  };

  // Agent Message Dispatch (Supports Customer-facing replies and Internal Team Notes)
  const handleSendMessage = async (text, options = {}) => {
    if (!selectedTicket || !text || !text.trim()) return;

    const channelId = selectedTicket.channelId || `channel_${selectedTicket.orderId}`;
    const targetUserId = selectedTicket.customer?.id;
    const isInternal = Boolean(options.isInternal);

    if (isInternal) {
      // Internal Note: Never sent to customer over Nexconn
      const internalMsg = {
        id: `note_${Date.now()}`,
        senderName: 'Sarah Lin',
        senderRole: 'internal_note',
        isInternal: true,
        text,
        timestamp: new Date().toISOString(),
        metadata: {
          type: 'INTERNAL_NOTE',
          isInternal: true,
          ticketId: selectedTicket.id
        }
      };

      setMessagesMap(prev => ({
        ...prev,
        [selectedTicket.id]: [...(prev[selectedTicket.id] || []), internalMsg]
      }));
      setNoticeMessage('Internal team note posted (confidential to team).');
      setTimeout(() => setNoticeMessage(null), 2500);
      return;
    }

    // Customer-facing message
    try {
      const sentMsg = await nexconnService.sendMessage({
        targetUserId,
        channelId,
        text,
        metadata: {
          orderId: selectedTicket.orderId,
          ticketId: selectedTicket.id,
        },
      });

      if (sentMsg) {
        setMessagesMap((prev) => ({
          ...prev,
          [selectedTicket.id]: nexconnService.getChannelMessages(channelId),
        }));

        if (selectedTicket.status !== 'Human Agent Active' && selectedTicket.status !== 'Resolved') {
          await handleUpdateStatus('Human Agent Active');
        }
      }
    } catch (err) {
      console.error('Failed to send agent reply:', err);
    }
  };

  const filteredTickets = tickets.filter((t) => {
    if (activeFilter === 'High Priority' && t.priority !== 'Critical' && t.priority !== 'High') {
      return false;
    }
    if (activeFilter === 'Human Requested' && !t.humanRequested && t.status !== 'Human Requested') {
      return false;
    }
    if (activeFilter === 'Resolved' && t.status !== 'Resolved') {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = t.customer?.name?.toLowerCase().includes(q);
      const matchOrder = t.orderId?.toLowerCase().includes(q);
      const matchIssue = t.category?.toLowerCase().includes(q);
      return matchName || matchOrder || matchIssue;
    }
    return true;
  });

  const isAtCapacity = effectiveStatus === 'At Capacity';

  return (
    <div className="flex flex-col h-full bg-[#0A0A0A] overflow-hidden">
      {/* 1. Header: Sarah Lin Identity, Availability Status, Capacity Badge & Knowledge Hub */}
      <div className="bg-[#0D0D0D] border-b border-[#1A1A1A] px-5 py-3 flex items-center justify-between shrink-0 text-xs">
        {/* Left: Agent Profile & Status Selector */}
        <div className="flex items-center space-x-3.5">
          <div className="flex items-center space-x-2.5">
            <div className="relative">
              <span className={`w-3 h-3 rounded-full block border-2 border-[#0D0D0D] ${
                isAtCapacity
                  ? 'bg-[#F59E0B] shadow-neon-sm'
                  : configuredStatus === 'Available'
                  ? 'bg-[#7CFF00] shadow-neon-sm'
                  : configuredStatus === 'Busy'
                  ? 'bg-[#EF4444]'
                  : configuredStatus === 'Away'
                  ? 'bg-[#F59E0B]'
                  : 'bg-[#6B7280]'
              }`} />
            </div>

            <div className="flex flex-col">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-sm text-[#FFFFFF]">Sarah Lin</span>
                <span className="text-[10px] text-[#7CFF00] font-mono px-1.5 py-0.2 rounded bg-[#7CFF00]/10 border border-[#7CFF00]/30 font-semibold">
                  {agentRole === 'support_lead' ? 'Support Lead' : 'Support Specialist'}
                </span>
                {/* Role Switcher for verification */}
                <button
                  onClick={() => setAgentRole(prev => prev === 'agent' ? 'support_lead' : 'agent')}
                  className="text-[10px] text-[#6B7280] hover:text-[#9CA3AF] underline font-mono hidden sm:inline"
                  title="Toggle Role between Specialist and Support Lead (RBAC Demo)"
                >
                  [{agentRole === 'agent' ? 'Switch to Lead' : 'Switch to Agent'}]
                </button>
              </div>
            </div>
          </div>

          {/* Configured Status Dropdown */}
          <div className="relative">
            <button
              onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-[#141414] hover:bg-[#1E1E1E] border border-[#262626] text-xs font-semibold text-white transition-colors"
            >
              <span>{configuredStatus}</span>
              <ChevronDown className="w-3 h-3 text-[#8A8A8A]" />
            </button>

            {statusDropdownOpen && (
              <div className="absolute left-0 mt-1.5 w-36 bg-[#141414] border border-[#2A2A2A] rounded-xl shadow-2xl py-1 z-50 animate-fadeIn text-xs">
                {['Available', 'Busy', 'Away', 'Offline'].map(st => (
                  <button
                    key={st}
                    onClick={() => handleConfiguredStatusChange(st)}
                    className={`w-full text-left px-3 py-1.5 hover:bg-[#222222] transition-colors flex items-center justify-between ${
                      configuredStatus === st ? 'text-[#7CFF00] font-bold' : 'text-[#CCCCCC]'
                    }`}
                  >
                    <span>{st}</span>
                    {configuredStatus === st && <Check className="w-3 h-3 text-[#7CFF00]" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Effective At Capacity Indication */}
          {isAtCapacity && (
            <span
              className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#F59E0B]/15 text-[#F59E0B] border border-[#F59E0B]/40 animate-pulse"
              title="Agent is at maximum capacity limit (3/3 tickets). Inbound tickets will queue until capacity is released."
            >
              <AlertCircle className="w-3 h-3 text-[#F59E0B]" />
              <span>At Capacity</span>
            </span>
          )}
        </div>

        {/* Right: Workload Metrics, Knowledge Hub & Split View Drawer Toggles */}
        <div className="flex items-center space-x-3">
          {/* Workload Indicator */}
          <div className="hidden md:flex items-center space-x-2 text-xs text-[#8A8A8A] font-mono">
            <span>Workload: <strong className={isAtCapacity ? "text-[#F59E0B]" : "text-[#7CFF00]"}>{activeWorkload}/{maxCapacity}</strong></span>
            <span>·</span>
            <span>Queue: <strong className="text-white">{stats.total}</strong></span>
          </div>

          {/* Knowledge Hub Drawer Trigger */}
          <button
            onClick={() => setIsKnowledgeHubOpen(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#141414] hover:bg-[#1E1E1E] border border-[#262626] text-xs font-semibold text-white hover:text-[#7CFF00] hover:border-[#7CFF00]/40 transition-all shadow-sm"
            title="Search and view approved brand knowledge and policies"
          >
            <BookOpen className="w-3.5 h-3.5 text-[#7CFF00]" />
            <span className="hidden sm:inline">Knowledge Hub</span>
          </button>
        </div>
      </div>

      {/* Floating Notice Banner */}
      {noticeMessage && (
        <div className="bg-[#182330] border-b border-[#234E70] px-4 py-1.5 text-xs text-[#60A5FA] flex items-center justify-between animate-fadeIn">
          <span>{noticeMessage}</span>
          <button onClick={() => setNoticeMessage(null)} className="text-[#60A5FA] hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* Mobile Tab Switcher */}
      <div className="md:hidden flex items-center border-b border-[#1A1A1A] bg-[#0D0D0D] text-xs shrink-0">
        <button
          onClick={() => setMobileTab('inbox')}
          className={`flex-1 py-2.5 text-center font-semibold ${
            mobileTab === 'inbox' ? 'text-[#7CFF00] border-b-2 border-[#7CFF00]' : 'text-[#8A8A8A]'
          }`}
        >
          Inbox ({filteredTickets.length})
        </button>
        <button
          onClick={() => setMobileTab('chat')}
          className={`flex-1 py-2.5 text-center font-semibold ${
            mobileTab === 'chat' ? 'text-[#7CFF00] border-b-2 border-[#7CFF00]' : 'text-[#8A8A8A]'
          }`}
        >
          Chat
        </button>
        <button
          onClick={() => {
            setMobileTab('copilot');
            setIsCopilotStandaloneOpen(true);
          }}
          className={`flex-1 py-2.5 text-center font-semibold ${
            mobileTab === 'copilot' ? 'text-[#7CFF00] border-b-2 border-[#7CFF00]' : 'text-[#8A8A8A]'
          }`}
        >
          Copilot
        </button>
      </div>

      {/* Main SaaS Workspace Body */}
      <div className="flex-1 flex overflow-hidden min-h-0 relative">
        {/* Column 1 (Left): Permanent Inbox Rail (~280px) */}
        {!isSplitView && (
          <div className={`shrink-0 h-full ${
            mobileTab === 'inbox' ? 'block w-full' : 'hidden md:block'
          }`}>
            <ConversationInbox
              tickets={filteredTickets}
              unassignedTickets={unassignedTickets}
              teamOverview={teamOverview}
              agentRoster={agentRoster}
              selectedTicket={selectedTicket}
              currentInboxView={currentInboxView}
              onSelectInboxView={setCurrentInboxView}
              onClaimTicket={handleClaimTicket}
              onSelectTicket={(t) => {
                const currentStatus = nexconnService.getTicketStatus(t.id)?.status || t.status;
                const updatedTicket = {
                  ...t,
                  status: currentStatus,
                  humanRequested: currentStatus === 'Human Requested',
                };
                setSelectedTicket(updatedTicket);
                if (onSelectTicketId) onSelectTicketId(t.id);
                const channelId = t.channelId || `channel_${t.orderId}`;
                setMessagesMap((prev) => ({
                  ...prev,
                  [t.id]: nexconnService.getChannelMessages(channelId),
                }));
                getTicket(t.id).then((res) => {
                  if (res?.ticket) {
                    setSelectedTicket(res.ticket);
                    setTickets((prev) => prev.map((item) => item.id === t.id ? { ...item, ...res.ticket } : item));
                  }
                }).catch(() => {});
                setMobileTab('chat');
              }}
              activeFilter={activeFilter}
              onSelectFilter={setActiveFilter}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              isCollapsed={isInboxCollapsed}
              onToggleCollapse={() => setIsInboxCollapsed(!isInboxCollapsed)}
              isSplitView={false}
              currentUserRole={agentRole}
            />
          </div>
        )}

        {/* In Split View Mode: Compact Slide-Out Inbox Drawer on Left */}
        {isSplitView && splitPanel === 'inbox' && (
          <div className="absolute left-0 top-0 bottom-[68px] z-30 w-[300px] max-w-[85%] shadow-2xl animate-in slide-in-from-left duration-200 border-r border-[#1E1E1E]">
            <ConversationInbox
              tickets={filteredTickets}
              unassignedTickets={unassignedTickets}
              teamOverview={teamOverview}
              agentRoster={agentRoster}
              selectedTicket={selectedTicket}
              currentInboxView={currentInboxView}
              onSelectInboxView={setCurrentInboxView}
              onClaimTicket={handleClaimTicket}
              onSelectTicket={(t) => {
                const stored = nexconnService.getTicketStatus(t.id);
                const currentStatus = stored?.status || t.status;
                const updatedTicket = {
                  ...t,
                  status: currentStatus,
                  humanRequested: currentStatus === 'Human Requested',
                  feedback: stored?.feedback || t.feedback,
                };
                setSelectedTicket(updatedTicket);
                if (onSelectTicketId) onSelectTicketId(t.id);
                const channelId = t.channelId || `channel_${t.orderId}`;
                setMessagesMap((prev) => ({
                  ...prev,
                  [t.id]: nexconnService.getChannelMessages(channelId),
                }));
                getTicket(t.id).then((res) => {
                  if (res?.ticket) {
                    setSelectedTicket(res.ticket);
                    setTickets((prev) => prev.map((item) => item.id === t.id ? { ...item, ...res.ticket } : item));
                  }
                }).catch(() => {});
                setSplitPanel('none');
              }}
              activeFilter={activeFilter}
              onSelectFilter={setActiveFilter}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              isCollapsed={false}
              isSplitView={true}
              onClose={() => setSplitPanel('none')}
              currentUserRole={agentRole}
            />
          </div>
        )}

        {/* Column 2 (Right): Full Conversation Workspace */}
        <div className={`flex-1 h-full min-w-0 flex flex-col ${
          mobileTab === 'chat' ? 'block' : 'hidden md:flex'
        }`}>
          {selectedTicket ? (
            <ChatWindow
              ticket={selectedTicket}
              messages={messagesMap[selectedTicket.id] || nexconnService.getChannelMessages(selectedTicket.channelId || `channel_${selectedTicket.orderId}`)}
              onSendMessage={handleSendMessage}
              onUpdateStatus={handleUpdateStatus}
              onTransferTicket={handleTransferTicket}
              onClaimTicket={handleClaimTicket}
              agentRoster={agentRoster}
              currentAgentId="user_sarah_lin"
              isCopilotOpen={isSplitView ? splitPanel === 'copilot' : isCopilotStandaloneOpen}
              onToggleCopilot={() => {
                if (isSplitView) {
                  setSplitPanel((prev) => prev === 'copilot' ? 'none' : 'copilot');
                } else {
                  setIsCopilotStandaloneOpen((prev) => !prev);
                }
              }}
              isSplitView={isSplitView}
              isInboxOpen={isSplitView ? splitPanel === 'inbox' : !isInboxCollapsed}
              onToggleInbox={() => {
                if (isSplitView) {
                  setSplitPanel((prev) => prev === 'inbox' ? 'none' : 'inbox');
                }
              }}
              inboxCount={filteredTickets.length}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center p-6 text-[#8A8A8A] text-sm">
              Select a conversation to begin.
            </div>
          )}
        </div>

        {/* Overlay Drawer: AI Copilot Panel */}
        {((isSplitView ? splitPanel === 'copilot' : isCopilotStandaloneOpen) || mobileTab === 'copilot') && selectedTicket && (
          <div className={`absolute right-0 top-0 ${isSplitView ? 'bottom-[68px]' : 'bottom-0'} z-30 w-[360px] md:w-[380px] max-w-[85%] shadow-2xl animate-in slide-in-from-right duration-200 border-l border-[#1E1E1E] ${
            mobileTab === 'copilot' ? 'block w-full max-w-full' : 'hidden md:block'
          }`}>
            <AICopilotPanel
              ticket={selectedTicket}
              messages={messagesMap[selectedTicket.id] || nexconnService.getChannelMessages(selectedTicket.channelId || `channel_${selectedTicket.orderId}`)}
              onApproveAndSend={handleSendMessage}
              onClose={() => {
                if (isSplitView) {
                  setSplitPanel('none');
                } else {
                  setIsCopilotStandaloneOpen(false);
                }
              }}
            />
          </div>
        )}

        {/* Knowledge Hub Drawer */}
        <KnowledgeHubDrawer
          isOpen={isKnowledgeHubOpen}
          onClose={() => setIsKnowledgeHubOpen(false)}
          currentUserRole={agentRole}
          onInsertCannedResponse={(cannedText) => {
            setIsKnowledgeHubOpen(false);
            setNoticeMessage('Canned response copied. Ready to paste in composer.');
            setTimeout(() => setNoticeMessage(null), 3000);
          }}
        />
      </div>
    </div>
  );
}

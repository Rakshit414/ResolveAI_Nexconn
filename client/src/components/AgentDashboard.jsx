import React, { useState, useEffect } from 'react';
import { 
  Inbox, 
  Flame, 
  UserCheck, 
  CheckCircle2, 
  Clock, 
  Sparkles,
  BarChart3,
  Shield,
  Layers,
  HelpCircle,
  Filter
} from 'lucide-react';
import { DEMO_CUSTOMERS, DEMO_AGENT } from '../data/demoData';
import { getTickets, updateTicket } from '../services/api';
import nexconnService from '../services/nexconnService';
import ConversationInbox from './ConversationInbox';
import ChatWindow from './ChatWindow';
import AICopilotPanel from './AICopilotPanel';

export default function AgentDashboard({ 
  selectedTicketId, 
  onSelectTicketId, 
  onOpenPolicies 
}) {
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [messagesMap, setMessagesMap] = useState({});
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [stats, setStats] = useState({
    total: 3,
    urgent: 2,
    humanHandoffs: 2,
    resolved: 0,
  });

  // Initialize tickets and agent session
  useEffect(() => {
    // Connect agent to Nexconn
    nexconnService.connectUser({
      id: DEMO_AGENT.id,
      name: DEMO_AGENT.name,
      avatar: DEMO_AGENT.avatar,
      role: 'agent',
    });

    // Seed tickets from DEMO_CUSTOMERS
    const initialTickets = DEMO_CUSTOMERS.map((c) => ({
      ...c.ticket,
      customer: {
        id: c.id,
        name: c.name,
        email: c.email,
        avatar: c.avatar,
        order: c.order,
      },
    }));

    setTickets(initialTickets);

    // Initial selected ticket
    const initialSelected = 
      initialTickets.find(t => t.id === selectedTicketId) || initialTickets[0];
    setSelectedTicket(initialSelected);

    // Seed initial message map
    const msgMap = {};
    initialTickets.forEach((t) => {
      msgMap[t.id] = [
        {
          id: `init_msg_${t.id}`,
          senderId: t.customer.id,
          senderName: t.customer.name,
          senderRole: 'customer',
          senderAvatar: t.customer.avatar,
          text: t.customer.order.initialMessage,
          timestamp: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
        },
      ];
    });
    setMessagesMap(msgMap);

    // Global listener for Nexconn messages across all channels
    initialTickets.forEach((t) => {
      nexconnService.subscribe(`channel_${t.orderId}`, (newMsg) => {
        setMessagesMap((prev) => {
          const currentList = prev[t.id] || [];
          if (currentList.some((m) => m.id === newMsg.id)) return prev;
          return {
            ...prev,
            [t.id]: [...currentList, newMsg],
          };
        });

        // If customer requested handoff, update ticket
        if (newMsg.senderRole === 'customer') {
          setTickets((prev) =>
            prev.map((item) =>
              item.id === t.id
                ? { ...item, lastUpdated: new Date().toISOString() }
                : item
            )
          );
        }
      });
    });
  }, []);

  // Update selected ticket when prop changes
  useEffect(() => {
    if (selectedTicketId && tickets.length > 0) {
      const match = tickets.find((t) => t.id === selectedTicketId);
      if (match) setSelectedTicket(match);
    }
  }, [selectedTicketId, tickets]);

  // Compute metrics
  useEffect(() => {
    const urgentCount = tickets.filter(
      (t) => t.priority === 'Critical' || t.priority === 'High'
    ).length;
    const handoffCount = tickets.filter((t) => t.humanRequested).length;
    const resolvedCount = tickets.filter((t) => t.status === 'Resolved').length;

    setStats({
      total: tickets.length,
      urgent: urgentCount,
      humanHandoffs: handoffCount,
      resolved: resolvedCount,
    });
  }, [tickets]);

  // Filtered tickets
  const filteredTickets = tickets.filter((t) => {
    if (activeFilter === 'High Priority' && t.priority !== 'Critical' && t.priority !== 'High') {
      return false;
    }
    if (activeFilter === 'Human Assistance Requested' && !t.humanRequested) {
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

  // Handle agent sending reply (either manual or approved AI suggestion)
  const handleSendMessage = async (text, isAiAssisted = false) => {
    if (!selectedTicket || !text.trim()) return;

    try {
      const sentMsg = await nexconnService.sendMessage(
        selectedTicket.customer.id,
        text,
        {
          orderId: selectedTicket.orderId,
          channelId: `channel_${selectedTicket.orderId}`,
          aiAssisted: isAiAssisted,
        }
      );

      if (sentMsg) {
        setMessagesMap((prev) => ({
          ...prev,
          [selectedTicket.id]: [...(prev[selectedTicket.id] || []), sentMsg],
        }));

        // Update ticket status to In Progress
        handleUpdateStatus('In Progress');
      }
    } catch (err) {
      console.error('Failed to send agent reply:', err);
    }
  };

  const handleUpdateStatus = (newStatus) => {
    if (!selectedTicket) return;

    setTickets((prev) =>
      prev.map((t) =>
        t.id === selectedTicket.id
          ? {
              ...t,
              status: newStatus,
              humanRequested: newStatus === 'Resolved' ? false : t.humanRequested,
              lastUpdated: new Date().toISOString(),
            }
          : t
      )
    );

    setSelectedTicket((prev) =>
      prev ? { ...prev, status: newStatus } : null
    );

    updateTicket(selectedTicket.id, { status: newStatus }).catch(console.warn);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-57px)] bg-[#070B14] overflow-hidden">
      {/* Top Agent Statistics Header Bar */}
      <div className="bg-[#0B1120] border-b border-slate-800 px-4 lg:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-bold text-white">Agent Operations Desk</span>
          </div>
          <span className="text-slate-600">|</span>
          <div className="flex items-center space-x-2 text-xs text-slate-300">
            <img
              src={DEMO_AGENT.avatar}
              alt={DEMO_AGENT.name}
              className="w-5 h-5 rounded-full border border-slate-700 object-cover"
            />
            <span className="font-semibold text-white">{DEMO_AGENT.name}</span>
            <span className="text-[11px] text-slate-400">({DEMO_AGENT.role})</span>
          </div>
        </div>

        {/* Quick KPI Stat Widgets */}
        <div className="flex items-center space-x-2 sm:space-x-4 text-xs">
          <div className="flex items-center space-x-1.5 px-3 py-1 rounded-xl bg-slate-900 border border-slate-800">
            <Inbox className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-slate-400">Queue:</span>
            <span className="font-bold text-white">{stats.total}</span>
          </div>

          <div className="flex items-center space-x-1.5 px-3 py-1 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400">
            <Flame className="w-3.5 h-3.5" />
            <span className="text-orange-300/80">Urgent:</span>
            <span className="font-bold text-orange-300">{stats.urgent}</span>
          </div>

          <div className="flex items-center space-x-1.5 px-3 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300">
            <UserCheck className="w-3.5 h-3.5" />
            <span className="text-amber-300/80">Handoffs:</span>
            <span className="font-bold text-amber-300">{stats.humanHandoffs}</span>
          </div>

          <div className="hidden md:flex items-center space-x-1.5 px-3 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span className="text-emerald-300/80">Resolved:</span>
            <span className="font-bold text-emerald-300">{stats.resolved}</span>
          </div>
        </div>
      </div>

      {/* Main 3-Column SaaS Layout */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden">
        {/* Left Column: Inbox & Ticket Queue (3 cols on lg) */}
        <div className="hidden md:block md:col-span-4 lg:col-span-3 h-full overflow-hidden">
          <ConversationInbox
            tickets={filteredTickets}
            selectedTicket={selectedTicket}
            onSelectTicket={(t) => {
              setSelectedTicket(t);
              if (onSelectTicketId) onSelectTicketId(t.id);
            }}
            activeFilter={activeFilter}
            onSelectFilter={setActiveFilter}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />
        </div>

        {/* Center Column: Active Conversation Chat (5 cols on lg) */}
        <div className="col-span-1 md:col-span-8 lg:col-span-5 h-full overflow-hidden flex flex-col">
          {selectedTicket ? (
            <ChatWindow
              ticket={selectedTicket}
              messages={messagesMap[selectedTicket.id] || []}
              onSendMessage={(text) => handleSendMessage(text, false)}
              onUpdateStatus={handleUpdateStatus}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center p-6 text-slate-500 text-sm">
              Select a conversation to start resolving.
            </div>
          )}
        </div>

        {/* Right Column: AI Copilot Panel (4 cols on lg) */}
        <div className="hidden lg:block lg:col-span-4 h-full overflow-hidden">
          {selectedTicket ? (
            <AICopilotPanel
              ticket={selectedTicket}
              messages={messagesMap[selectedTicket.id] || []}
              onApproveAndSend={(text) => handleSendMessage(text, true)}
              onOpenPolicies={onOpenPolicies}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

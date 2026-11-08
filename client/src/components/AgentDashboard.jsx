import React, { useState, useEffect, useRef } from 'react';
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
  const [isCopilotOpen, setIsCopilotOpen] = useState(true);
  const [mobileTab, setMobileTab] = useState('chat'); // 'inbox' | 'chat' | 'copilot'
  const [stats, setStats] = useState({
    total: 3,
    urgent: 2,
    humanHandoffs: 2,
    resolved: 0,
  });

  const subscriptionsRef = useRef([]);

  // Initialize tickets and agent session
  useEffect(() => {
    nexconnService.connectUser({
      id: DEMO_AGENT.id,
      name: DEMO_AGENT.name,
      avatar: DEMO_AGENT.avatar,
      role: 'agent',
    });

    const initialTickets = DEMO_CUSTOMERS.map((c) => ({
      ...c.ticket,
      channelId: c.channelId || `channel_${c.order.orderId}`,
      customer: {
        id: c.id,
        name: c.name,
        email: c.email,
        channelId: c.channelId || `channel_${c.order.orderId}`,
        avatar: c.avatar,
        order: c.order,
      },
    }));

    setTickets(initialTickets);

    const initialSelected = 
      initialTickets.find(t => t.id === selectedTicketId) || initialTickets[0];
    setSelectedTicket(initialSelected);

    // Initial message history loaded from nexconnService (isolated by channel)
    const initialMap = {};
    initialTickets.forEach((t) => {
      const channelId = t.channelId || `channel_${t.orderId}`;
      initialMap[t.id] = nexconnService.getChannelMessages(channelId);
    });
    setMessagesMap(initialMap);

    // Subscribe to each channel's events independently and store cleanup handlers
    // Clean up any existing listeners first
    subscriptionsRef.current.forEach((unsub) => unsub());
    subscriptionsRef.current = [];

    initialTickets.forEach((t) => {
      const channelId = t.channelId || `channel_${t.orderId}`;
      const unsub = nexconnService.subscribe(channelId, (newMsg) => {
        // When a message arrives on this channel, update only this ticket's messages
        setMessagesMap((prev) => {
          const currentList = prev[t.id] || [];
          // Deduplicate by message ID
          if (currentList.some((m) => m.id === newMsg.id || (m.messageId && m.messageId === newMsg.messageId))) {
            return prev;
          }
          return {
            ...prev,
            [t.id]: [...currentList, newMsg],
          };
        });

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
      subscriptionsRef.current.push(unsub);
    });

    return () => {
      subscriptionsRef.current.forEach((unsub) => unsub());
      subscriptionsRef.current = [];
    };
  }, []);

  // Sync selectedTicket when prop changes
  useEffect(() => {
    if (selectedTicketId && tickets.length > 0) {
      const match = tickets.find((t) => t.id === selectedTicketId);
      if (match) {
        setSelectedTicket(match);
        // Ensure this ticket's messages are fresh from channel store
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

  // Handle agent sending a reply
  const handleSendMessage = async (text) => {
    if (!selectedTicket || !text || !text.trim()) return;

    const channelId = selectedTicket.channelId || `channel_${selectedTicket.orderId}`;
    const targetUserId = selectedTicket.customer?.id;

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
        // Sync message map from the canonical channel history (prevents duplicate insertion)
        setMessagesMap((prev) => ({
          ...prev,
          [selectedTicket.id]: nexconnService.getChannelMessages(channelId),
        }));

        if (selectedTicket.status !== 'Human Agent Active' && selectedTicket.status !== 'Resolved') {
          handleUpdateStatus('Human Agent Active');
        }
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
    <div className="flex flex-col h-[calc(100vh-52px)] bg-[#090909] overflow-hidden">
      {/* Subdued Status & Metrics Sub-header */}
      <div className="bg-[#0E0E0E] border-b border-[#222222] px-4 py-2 flex items-center justify-between shrink-0 text-xs">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-[#7CFF00] shadow-neon-sm" />
            <span className="font-semibold text-[#FFFFFF]">Agent Workspace</span>
            <span className="text-[#8A8A8A] hidden sm:inline">({DEMO_AGENT.name})</span>
          </div>
        </div>

        {/* Minimal metrics text indicators */}
        <div className="flex items-center space-x-3 text-[11px] text-[#8A8A8A]">
          <span>Queue: <strong className="text-[#FFFFFF]">{stats.total}</strong></span>
          <span>·</span>
          <span>Urgent: <strong className={stats.urgent > 0 ? "text-[#FF334B]" : "text-[#FFFFFF]"}>{stats.urgent}</strong></span>
          <span>·</span>
          <span>Handoffs: <strong className="text-[#FFFFFF]">{stats.humanHandoffs}</strong></span>
          <span>·</span>
          <span>Resolved: <strong className="text-[#7CFF00]">{stats.resolved}</strong></span>
        </div>
      </div>

      {/* Mobile Tab Switcher */}
      <div className="md:hidden flex items-center border-b border-[#222222] bg-[#0E0E0E] text-xs">
        <button
          onClick={() => setMobileTab('inbox')}
          className={`flex-1 py-2 text-center font-medium ${
            mobileTab === 'inbox' ? 'text-[#7CFF00] border-b-2 border-[#7CFF00]' : 'text-[#8A8A8A]'
          }`}
        >
          Inbox ({filteredTickets.length})
        </button>
        <button
          onClick={() => setMobileTab('chat')}
          className={`flex-1 py-2 text-center font-medium ${
            mobileTab === 'chat' ? 'text-[#7CFF00] border-b-2 border-[#7CFF00]' : 'text-[#8A8A8A]'
          }`}
        >
          Chat
        </button>
        <button
          onClick={() => setMobileTab('copilot')}
          className={`flex-1 py-2 text-center font-medium ${
            mobileTab === 'copilot' ? 'text-[#7CFF00] border-b-2 border-[#7CFF00]' : 'text-[#8A8A8A]'
          }`}
        >
          AI Copilot
        </button>
      </div>

      {/* Main SaaS Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Conversation Inbox */}
        <div className={`w-full md:w-64 lg:w-72 shrink-0 h-full ${
          mobileTab === 'inbox' ? 'block' : 'hidden md:block'
        }`}>
          <ConversationInbox
            tickets={filteredTickets}
            selectedTicket={selectedTicket}
            onSelectTicket={(t) => {
              setSelectedTicket(t);
              if (onSelectTicketId) onSelectTicketId(t.id);
              // Fresh load of messages for this ticket from channel store
              const channelId = t.channelId || `channel_${t.orderId}`;
              setMessagesMap((prev) => ({
                ...prev,
                [t.id]: nexconnService.getChannelMessages(channelId),
              }));
              setMobileTab('chat');
            }}
            activeFilter={activeFilter}
            onSelectFilter={setActiveFilter}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />
        </div>

        {/* Center: Conversation Workspace */}
        <div className={`flex-1 h-full min-w-0 ${
          mobileTab === 'chat' ? 'block' : 'hidden md:block'
        }`}>
          {selectedTicket ? (
            <ChatWindow
              ticket={selectedTicket}
              messages={messagesMap[selectedTicket.id] || nexconnService.getChannelMessages(selectedTicket.channelId || `channel_${selectedTicket.orderId}`)}
              onSendMessage={handleSendMessage}
              onUpdateStatus={handleUpdateStatus}
              isCopilotOpen={isCopilotOpen}
              onToggleCopilot={() => setIsCopilotOpen(!isCopilotOpen)}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center p-6 text-[#8A8A8A] text-xs">
              Select a conversation to begin.
            </div>
          )}
        </div>

        {/* Right: AI Copilot Panel (Collapsible) */}
        {isCopilotOpen && selectedTicket && (
          <div className={`w-full md:w-72 lg:w-80 shrink-0 h-full ${
            mobileTab === 'copilot' ? 'block' : 'hidden lg:block'
          }`}>
            <AICopilotPanel
              ticket={selectedTicket}
              messages={messagesMap[selectedTicket.id] || nexconnService.getChannelMessages(selectedTicket.channelId || `channel_${selectedTicket.orderId}`)}
              onApproveAndSend={handleSendMessage}
              onClose={() => setIsCopilotOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { DEMO_CUSTOMERS, DEMO_AGENT } from '../data/demoData';
import { getTickets, updateTicket, takeOverTicket, resolveTicket } from '../services/api';
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

    // Seed tickets from DEMO_CUSTOMERS merged with stored ticket statuses
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

    // Initial message history loaded from nexconnService (isolated by channel)
    const initialMap = {};
    initialTickets.forEach((t) => {
      const channelId = t.channelId || `channel_${t.orderId}`;
      initialMap[t.id] = nexconnService.getChannelMessages(channelId);
    });
    setMessagesMap(initialMap);

    // Fetch latest tickets from backend to ensure cross-restart sync
    getTickets()
      .then((res) => {
        if (res?.tickets && res.tickets.length > 0) {
          setTickets((prev) =>
            prev.map((t) => {
              const remote = res.tickets.find((rt) => rt.id === t.id);
              if (remote) {
                nexconnService.setTicketStatus(t.id, remote.status, { lastUpdated: remote.lastUpdated });
                return {
                  ...t,
                  status: remote.status,
                  priority: remote.priority || t.priority,
                  category: remote.category || t.category,
                  humanRequested: remote.status === 'Human Requested' || Boolean(remote.humanRequested),
                  summary: remote.summary || t.summary,
                  suggestedReply: remote.suggestedReply || t.suggestedReply,
                  pendingAction: remote.pendingAction || t.pendingAction,
                };
              }
              return t;
            })
          );
        }
      })
      .catch(() => {});

    // Subscribe to each channel's events independently and store cleanup handlers
    subscriptionsRef.current.forEach((unsub) => unsub());
    subscriptionsRef.current = [];

    initialTickets.forEach((t) => {
      const channelId = t.channelId || `channel_${t.orderId}`;
      const unsub = nexconnService.subscribe(channelId, (newMsg) => {
        // When a message arrives on this channel, update only this ticket's messages
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

        // If message contains status transition metadata or status change text
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
        } else if (newMsg.senderRole === 'customer') {
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
          await handleUpdateStatus('Human Agent Active');
        }
      }
    } catch (err) {
      console.error('Failed to send agent reply:', err);
    }
  };

  const handleUpdateStatus = async (newStatus) => {
    if (!selectedTicket) return;

    // 1. Update local state
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

    // 2. Persist in local storage
    nexconnService.setTicketStatus(selectedTicket.id, newStatus);

    // 3. Update backend
    try {
      if (newStatus === 'Human Agent Active') {
        await takeOverTicket(selectedTicket.id).catch(console.warn);
      } else if (newStatus === 'Resolved') {
        await resolveTicket(selectedTicket.id).catch(console.warn);
      } else {
        await updateTicket(selectedTicket.id, { status: newStatus }).catch(console.warn);
      }
    } catch (err) {
      console.warn('Backend ticket update error:', err);
    }

    // 4. Broadcast status change notice over Nexconn
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

      // Update messagesMap
      setMessagesMap((prev) => ({
        ...prev,
        [selectedTicket.id]: nexconnService.getChannelMessages(channelId),
      }));
    } catch (err) {
      console.warn('Nexconn status broadcast error:', err);
    }
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
              const currentStatus = nexconnService.getTicketStatus(t.id)?.status || t.status;
              const updatedTicket = {
                ...t,
                status: currentStatus,
                humanRequested: currentStatus === 'Human Requested',
              };
              setSelectedTicket(updatedTicket);
              if (onSelectTicketId) onSelectTicketId(t.id);
              // Fresh load of messages for this ticket from channel store
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

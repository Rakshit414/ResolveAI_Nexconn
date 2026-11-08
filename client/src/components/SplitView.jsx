import React, { useState } from 'react';
import CustomerPortal from './CustomerPortal';
import AgentDashboard from './AgentDashboard';
import { DEMO_CUSTOMERS } from '../data/demoData';

export default function SplitView({ onOpenPolicies }) {
  const [currentCustomer, setCurrentCustomer] = useState(DEMO_CUSTOMERS[0]);
  const [selectedTicketId, setSelectedTicketId] = useState(DEMO_CUSTOMERS[0].ticket.id);

  const handleCustomerChange = (cust) => {
    setCurrentCustomer(cust);
    setSelectedTicketId(cust.ticket.id);
  };

  const handleTicketSelect = (tktId) => {
    setSelectedTicketId(tktId);
    const matched = DEMO_CUSTOMERS.find(c => c.ticket.id === tktId);
    if (matched && matched.id !== currentCustomer.id) {
      setCurrentCustomer(matched);
    }
  };

  return (
    <div className="h-[calc(100vh-52px)] flex flex-col lg:flex-row bg-[#090909] overflow-hidden">
      {/* Left Pane: Customer Experience (~40% Width) */}
      <div className="w-full lg:w-[40%] flex flex-col h-full border-b lg:border-b-0 lg:border-r border-[#1E1E1E] shrink-0 min-w-0 bg-[#090909] overflow-hidden">
        {/* Subtle Demonstration Banner */}
        <div className="px-3.5 py-1.5 bg-[#0C0C0C] border-b border-[#1E1E1E] text-xs flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7CFF00] shadow-neon-sm" />
            <span className="font-semibold text-[#FFFFFF] text-xs">Customer Experience</span>
          </div>
          <span className="text-[10px] font-mono text-[#7CFF00]">{currentCustomer.name}</span>
        </div>

        <div className="flex-1 overflow-hidden min-h-0">
          <CustomerPortal
            customer={currentCustomer}
            onSelectCustomer={handleCustomerChange}
            compact={true}
          />
        </div>
      </div>

      {/* Right Pane: Support Agent Workspace (~60% Width) */}
      <div className="w-full lg:w-[60%] flex flex-col h-full min-w-0 bg-[#090909] overflow-hidden">
        {/* Subtle Demonstration Banner */}
        <div className="px-3.5 py-1.5 bg-[#0C0C0C] border-b border-[#1E1E1E] text-xs flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7CFF00] shadow-neon-sm" />
            <span className="font-semibold text-[#FFFFFF] text-xs">Agent Workspace & AI Copilot</span>
          </div>
          <div className="flex items-center space-x-2 text-[10px] text-[#8A8A8A]">
            <span className="px-1.5 py-0.2 rounded bg-[#141414] border border-[#222222] font-mono text-[9px] text-[#7CFF00]">
              Nexconn Real-Time
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-hidden min-h-0">
          <AgentDashboard
            selectedTicketId={selectedTicketId}
            onSelectTicketId={handleTicketSelect}
            onOpenPolicies={onOpenPolicies}
            isSplitView={true}
          />
        </div>
      </div>
    </div>
  );
}
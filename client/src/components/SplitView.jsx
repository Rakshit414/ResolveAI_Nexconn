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
    <div className="h-[calc(100vh-52px)] grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#222222] bg-[#090909] overflow-hidden">
      {/* Left Pane: Customer Experience */}
      <div className="h-full overflow-y-auto bg-[#090909] flex flex-col">
        <div className="px-4 py-1.5 bg-[#0E0E0E] border-b border-[#222222] text-xs text-[#8A8A8A] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7CFF00] shadow-neon-sm" />
            <span className="font-semibold text-[#FFFFFF]">Customer Experience</span>
          </div>
          <span className="text-[11px] font-mono text-[#7CFF00]">{currentCustomer.name} ({currentCustomer.order.orderId})</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <CustomerPortal
            customer={currentCustomer}
            onSelectCustomer={handleCustomerChange}
          />
        </div>
      </div>

      {/* Right Pane: Support Agent Workspace with AI Copilot */}
      <div className="h-full overflow-hidden flex flex-col bg-[#090909]">
        <div className="px-4 py-1.5 bg-[#0E0E0E] border-b border-[#222222] text-xs text-[#8A8A8A] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7CFF00] shadow-neon-sm" />
            <span className="font-semibold text-[#FFFFFF]">Agent Workspace & AI Copilot</span>
          </div>
          <span className="text-[11px] text-[#8A8A8A]">Sarah Lin</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <AgentDashboard
            selectedTicketId={selectedTicketId}
            onSelectTicketId={handleTicketSelect}
            onOpenPolicies={onOpenPolicies}
          />
        </div>
      </div>
    </div>
  );
}

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

  return (
    <div className="h-[calc(100vh-52px)] grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#353B35] bg-[#191A19] overflow-hidden">
      {/* Left Pane: Customer Experience */}
      <div className="h-full overflow-y-auto bg-[#191A19] flex flex-col">
        <div className="px-4 py-1.5 bg-[#111311] border-b border-[#353B35] text-xs text-[#929A91] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#174B35]" />
            <span className="font-medium text-[#D5D9D3]">Customer View</span>
          </div>
          <span className="text-[11px] font-mono">{currentCustomer.name} ({currentCustomer.order.orderId})</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <CustomerPortal
            customer={currentCustomer}
            onSelectCustomer={handleCustomerChange}
          />
        </div>
      </div>

      {/* Right Pane: Support Agent Workspace with AI Copilot */}
      <div className="h-full overflow-hidden flex flex-col bg-[#111311]">
        <div className="px-4 py-1.5 bg-[#111311] border-b border-[#353B35] text-xs text-[#929A91] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#174B35]" />
            <span className="font-medium text-[#D5D9D3]">Agent Workspace & AI Copilot</span>
          </div>
          <span className="text-[11px]">Sarah Lin</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <AgentDashboard
            selectedTicketId={selectedTicketId}
            onSelectTicketId={setSelectedTicketId}
            onOpenPolicies={onOpenPolicies}
          />
        </div>
      </div>
    </div>
  );
}

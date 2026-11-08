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
    <div className="h-[calc(100vh-57px)] grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-800 bg-[#070B14] overflow-hidden">
      {/* Left Pane: Customer Experience */}
      <div className="h-full overflow-y-auto bg-[#070B14]">
        <div className="p-2 bg-slate-900/70 border-b border-slate-800 text-center text-xs font-semibold text-brand-indigo flex items-center justify-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-brand-indigo animate-ping" />
          <span>Live Customer View ({currentCustomer.name})</span>
        </div>
        <div className="p-2 sm:p-4">
          <CustomerPortal
            customer={currentCustomer}
            onSelectCustomer={handleCustomerChange}
          />
        </div>
      </div>

      {/* Right Pane: Support Agent Workspace with AI Copilot */}
      <div className="h-full overflow-hidden flex flex-col bg-[#0B1120]">
        <div className="p-2 bg-slate-900/70 border-b border-slate-800 text-center text-xs font-semibold text-purple-400 flex items-center justify-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-purple-400" />
          <span>Live Agent Dashboard (Sarah Lin + AI Copilot)</span>
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

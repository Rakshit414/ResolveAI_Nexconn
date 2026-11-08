import React, { useState } from 'react';
import CustomerPortal from './CustomerPortal';
import AgentDashboard from './AgentDashboard';
import { DEMO_CUSTOMERS } from '../data/demoData';

export default function SplitView({ 
  currentCustomer: propCustomer, 
  onSelectCustomer: propSelectCustomer, 
  selectedTicketId: propTicketId, 
  onSelectTicketId: propSelectTicketId, 
  onOpenPolicies 
}) {
  const [localCustomer, setLocalCustomer] = useState(DEMO_CUSTOMERS[0]);
  const [localTicketId, setLocalTicketId] = useState(DEMO_CUSTOMERS[0].ticket.id);

  // Authoritative Customer State from props or local fallback
  const activeCustomer = propCustomer || localCustomer;
  const activeTicketId = propTicketId || localTicketId;

  const handleCustomerChange = (cust) => {
    if (propSelectCustomer) {
      propSelectCustomer(cust);
    } else {
      setLocalCustomer(cust);
      setLocalTicketId(cust.ticket.id);
    }
  };

  const handleTicketSelect = (tktId) => {
    if (propSelectTicketId) {
      propSelectTicketId(tktId);
    } else {
      setLocalTicketId(tktId);
      const matched = DEMO_CUSTOMERS.find(c => c.ticket.id === tktId);
      if (matched) setLocalCustomer(matched);
    }
  };

  return (
    <div className="h-full w-full flex flex-col lg:flex-row gap-3.5 lg:gap-4 overflow-hidden bg-[#090909]">
      {/* Left Pane: Customer Experience (~38% Width on Desktop) */}
      <div className="w-full lg:w-[38%] h-full flex flex-col rounded-2xl bg-[#0C0C0C] border border-[#1E1E1E] shadow-2xl overflow-hidden shrink-0 min-w-0">
        <CustomerPortal
          customer={activeCustomer}
          onSelectCustomer={handleCustomerChange}
          compact={true}
        />
      </div>

      {/* Right Pane: Agent Workspace (~62% Width on Desktop) */}
      <div className="w-full lg:w-[62%] h-full flex flex-col rounded-2xl bg-[#0C0C0C] border border-[#1E1E1E] shadow-2xl overflow-hidden min-w-0">
        <AgentDashboard
          selectedTicketId={activeTicketId}
          onSelectTicketId={handleTicketSelect}
          onOpenPolicies={onOpenPolicies}
          isSplitView={true}
        />
      </div>
    </div>
  );
}
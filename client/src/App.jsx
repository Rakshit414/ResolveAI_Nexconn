import React, { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import CustomerPortal from './components/CustomerPortal';
import AgentDashboard from './components/AgentDashboard';
import SplitView from './components/SplitView';
import PolicyDrawer from './components/PolicyDrawer';
import { DEMO_CUSTOMERS } from './data/demoData';

export default function App() {
  const getInitialCustomer = () => {
    try {
      if (typeof window !== 'undefined' && window.location.search) {
        const params = new URLSearchParams(window.location.search);
        const custId = params.get('customer') || params.get('id');
        const orderId = params.get('order');
        if (custId) {
          const found = DEMO_CUSTOMERS.find(c => c.id === custId);
          if (found) return found;
        }
        if (orderId) {
          const found = DEMO_CUSTOMERS.find(c => c.order.orderId === orderId);
          if (found) return found;
        }
      }
    } catch (e) {
      // ignore
    }
    return DEMO_CUSTOMERS[0];
  };

  const initialCust = getInitialCustomer();
  const [currentCustomer, setCurrentCustomer] = useState(initialCust);
  const [selectedTicketId, setSelectedTicketId] = useState(initialCust.ticket.id);
  const [isPoliciesOpen, setIsPoliciesOpen] = useState(false);

  // Authoritative Customer Selection: Synchronizes both panes & all components
  const handleSelectCustomer = (customer) => {
    if (!customer) return;
    setCurrentCustomer(customer);
    const tId = customer.ticket?.id || customer.id;
    setSelectedTicketId(tId);
  };

  // Authoritative Ticket Selection from Agent Inbox: Synchronizes both panes & all components
  const handleSelectTicketId = (ticketId) => {
    if (!ticketId) return;
    setSelectedTicketId(ticketId);
    const matched = DEMO_CUSTOMERS.find(c => c.ticket?.id === ticketId || c.id === ticketId);
    if (matched) {
      setCurrentCustomer(matched);
    }
  };

  return (
    <div className="h-screen bg-[#090909] text-[#FFFFFF] flex flex-col font-sans overflow-hidden">
      {/* Top Global Navigation Bar */}
      <Navbar
        currentCustomer={currentCustomer}
        onSelectCustomer={handleSelectCustomer}
        onOpenPolicies={() => setIsPoliciesOpen(true)}
      />

      {/* Main Workspace Canvas with intentional breathing space below navbar */}
      <main className="flex-1 p-3 md:p-4 overflow-hidden bg-[#090909] min-h-0">
        <Routes>
          <Route
            path="/"
            element={
              <div className="h-full max-w-2xl mx-auto flex flex-col justify-center overflow-hidden">
                <CustomerPortal
                  customer={currentCustomer}
                  onSelectCustomer={handleSelectCustomer}
                />
              </div>
            }
          />
          <Route
            path="/customer"
            element={
              <div className="h-full max-w-2xl mx-auto flex flex-col justify-center overflow-hidden">
                <CustomerPortal
                  customer={currentCustomer}
                  onSelectCustomer={handleSelectCustomer}
                />
              </div>
            }
          />
          <Route
            path="/agent"
            element={
              <div className="h-full w-full rounded-2xl bg-[#0E0E0E] border border-[#1E1E1E] overflow-hidden shadow-2xl flex flex-col">
                <AgentDashboard
                  selectedTicketId={selectedTicketId}
                  onSelectTicketId={handleSelectTicketId}
                  onOpenPolicies={() => setIsPoliciesOpen(true)}
                />
              </div>
            }
          />
          <Route
            path="/split"
            element={
              <SplitView
                currentCustomer={currentCustomer}
                onSelectCustomer={handleSelectCustomer}
                selectedTicketId={selectedTicketId}
                onSelectTicketId={handleSelectTicketId}
                onOpenPolicies={() => setIsPoliciesOpen(true)}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Policies Reference Drawer */}
      <PolicyDrawer
        isOpen={isPoliciesOpen}
        onClose={() => setIsPoliciesOpen(false)}
      />
    </div>
  );
}
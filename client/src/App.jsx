import React, { useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import CustomerPortal from './components/CustomerPortal';
import AgentDashboard from './components/AgentDashboard';
import SplitView from './components/SplitView';
import PolicyDrawer from './components/PolicyDrawer';
import NovaCartStorefront from './components/NovaCartStorefront';
import WidgetFrame from './components/WidgetFrame';
import { DEMO_CUSTOMERS } from './data/demoData';
import { CartProvider } from './context/CartContext';

export default function App() {
  const location = useLocation();
  const isFrameMode = location.pathname === '/widget-frame';

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

  // Authoritative Customer Selection: Synchronizes both panes & all views
  const handleSelectCustomer = (customer) => {
    if (!customer) return;
    setCurrentCustomer(customer);
    const tId = customer.ticket?.id || customer.id;
    setSelectedTicketId(tId);
  };

  // Authoritative Ticket Selection from Agent Inbox: Synchronizes both panes & all views
  const handleSelectTicketId = (ticketId) => {
    if (!ticketId) return;
    setSelectedTicketId(ticketId);
    const matched = DEMO_CUSTOMERS.find(c => c.ticket?.id === ticketId || c.id === ticketId);
    if (matched) {
      setCurrentCustomer(matched);
    }
  };

  // Standalone embed iframe route: pure widget, zero outer chrome
  if (isFrameMode) {
    return (
      <div className="w-screen h-screen bg-transparent overflow-hidden">
        <WidgetFrame />
      </div>
    );
  }

  return (
    <CartProvider>
      <div className="h-screen bg-[#090909] text-[#FFFFFF] flex flex-col font-sans overflow-hidden">
        {/* Top Global Navigation Bar */}
        <Navbar
          currentCustomer={currentCustomer}
          onSelectCustomer={handleSelectCustomer}
          onOpenPolicies={() => setIsPoliciesOpen(true)}
        />

        {/* Main Workspace Canvas */}
        <main className="flex-1 overflow-hidden bg-[#090909] min-h-0 flex flex-col">
          <Routes>
            {/* Storefront Experience with Floating Support Widget */}
            <Route
              path="/"
              element={
                <NovaCartStorefront
                  currentCustomer={currentCustomer}
                  onSelectCustomer={handleSelectCustomer}
                />
              }
            />
            <Route
              path="/store"
              element={
                <NovaCartStorefront
                  currentCustomer={currentCustomer}
                  onSelectCustomer={handleSelectCustomer}
                />
              }
            />

            {/* Dedicated Customer Portal View (Preserved 100%) */}
            <Route
              path="/customer"
              element={
                <div className="h-full p-3 md:p-4 lg:p-5 flex flex-col min-h-0">
                  <div className="h-full max-w-[1150px] w-full mx-auto flex flex-col rounded-2xl bg-[#0C0C0C] border border-[#1E1E1E] shadow-2xl overflow-hidden">
                    <CustomerPortal
                      customer={currentCustomer}
                      onSelectCustomer={handleSelectCustomer}
                      compact={false}
                    />
                  </div>
                </div>
              }
            />

            {/* Agent Dashboard View (Preserved 100%) */}
            <Route
              path="/agent"
              element={
                <div className="h-full p-3 md:p-4 lg:p-5 flex flex-col min-h-0">
                  <div className="h-full w-full rounded-2xl bg-[#0C0C0C] border border-[#1E1E1E] overflow-hidden shadow-2xl flex flex-col">
                    <AgentDashboard
                      selectedTicketId={selectedTicketId}
                      onSelectTicketId={handleSelectTicketId}
                      onOpenPolicies={() => setIsPoliciesOpen(true)}
                    />
                  </div>
                </div>
              }
            />

            {/* Side-by-Side Split View (Preserved 100%) */}
            <Route
              path="/split"
              element={
                <div className="h-full p-3 md:p-4 lg:p-5 flex flex-col min-h-0">
                  <SplitView
                    currentCustomer={currentCustomer}
                    onSelectCustomer={handleSelectCustomer}
                    selectedTicketId={selectedTicketId}
                    onSelectTicketId={handleSelectTicketId}
                    onOpenPolicies={() => setIsPoliciesOpen(true)}
                  />
                </div>
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
    </CartProvider>
  );
}

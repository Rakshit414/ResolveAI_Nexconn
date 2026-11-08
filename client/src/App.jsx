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

  const handleSelectCustomer = (customer) => {
    setCurrentCustomer(customer);
    setSelectedTicketId(customer.ticket.id);
  };

  return (
    <div className="min-h-screen bg-[#090909] text-[#FFFFFF] flex flex-col font-sans">
      {/* Top Global Navigation Bar */}
      <Navbar
        currentCustomer={currentCustomer}
        onSelectCustomer={handleSelectCustomer}
        onOpenPolicies={() => setIsPoliciesOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route
            path="/"
            element={
              <div className="h-[calc(100vh-52px)] p-2 md:p-4 flex justify-center overflow-hidden bg-[#090909]">
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
              <div className="h-[calc(100vh-52px)] p-2 md:p-4 flex justify-center overflow-hidden bg-[#090909]">
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
              <AgentDashboard
                selectedTicketId={selectedTicketId}
                onSelectTicketId={setSelectedTicketId}
                onOpenPolicies={() => setIsPoliciesOpen(true)}
              />
            }
          />
          <Route
            path="/split"
            element={
              <SplitView
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

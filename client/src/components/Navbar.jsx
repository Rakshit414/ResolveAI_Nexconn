import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  ShieldCheck, 
  User, 
  Columns, 
  BookOpen, 
  ChevronDown,
  MessageSquare
} from 'lucide-react';
import { DEMO_CUSTOMERS } from '../data/demoData';

export default function Navbar({ 
  currentCustomer, 
  onSelectCustomer, 
  onOpenPolicies 
}) {
  const location = useLocation();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const isActive = (path) => {
    if (path === '/customer') {
      return location.pathname === '/customer' || location.pathname === '/';
    }
    return location.pathname === path;
  };

  return (
    <header className="sticky top-0 z-50 bg-[#111311] border-b border-[#353B35] px-4 lg:px-6 h-13 flex items-center shrink-0">
      <div className="w-full flex items-center justify-between">
        
        {/* Left: Understated Brand Identity */}
        <div className="flex items-center space-x-6">
          <Link to="/" className="flex items-center space-x-2.5">
            <div className="w-7 h-7 rounded bg-[#174B35] flex items-center justify-center text-[#D5D9D3]">
              <MessageSquare className="w-4 h-4" />
            </div>
            <span className="font-semibold text-sm tracking-tight text-[#D5D9D3]">
              Resolve <span className="text-[#929A91] font-normal">AI</span>
            </span>
          </Link>

          {/* Minimal Navigation */}
          <nav className="flex items-center space-x-1">
            <Link
              to="/customer"
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                isActive('/customer')
                  ? 'bg-[#174B35] text-[#D5D9D3]'
                  : 'text-[#929A91] hover:text-[#D5D9D3] hover:bg-[#1E211E]'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>Customer</span>
            </Link>

            <Link
              to="/agent"
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                isActive('/agent')
                  ? 'bg-[#174B35] text-[#D5D9D3]'
                  : 'text-[#929A91] hover:text-[#D5D9D3] hover:bg-[#1E211E]'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Agent</span>
            </Link>

            <Link
              to="/split"
              className={`hidden md:flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                isActive('/split')
                  ? 'bg-[#174B35] text-[#D5D9D3]'
                  : 'text-[#929A91] hover:text-[#D5D9D3] hover:bg-[#1E211E]'
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
              <span>Split View</span>
            </Link>
          </nav>
        </div>

        {/* Right: Customer Profile Switcher & Policies */}
        <div className="flex items-center space-x-3">
          {/* Customer Switcher */}
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center space-x-2 bg-[#191A19] hover:bg-[#242724] text-[#D5D9D3] border border-[#353B35] px-2.5 py-1.5 rounded text-xs transition-colors"
            >
              <img
                src={currentCustomer?.avatar || DEMO_CUSTOMERS[0].avatar}
                alt={currentCustomer?.name}
                className="w-4 h-4 rounded-full object-cover grayscale"
              />
              <span className="font-medium text-[#D5D9D3]">{currentCustomer?.name || 'Customer'}</span>
              <span className="text-[11px] text-[#929A91] font-mono">({currentCustomer?.order?.orderId})</span>
              <ChevronDown className="w-3.5 h-3.5 text-[#929A91]" />
            </button>

            {dropdownOpen && (
              <div 
                className="absolute right-0 mt-1 w-64 bg-[#242724] border border-[#353B35] rounded shadow-xl py-1 z-50 text-xs"
                onClick={() => setDropdownOpen(false)}
              >
                <div className="px-3 py-1.5 text-[10px] font-semibold text-[#929A91] uppercase tracking-wider border-b border-[#353B35]">
                  Select Customer
                </div>
                {DEMO_CUSTOMERS.map((cust) => (
                  <button
                    key={cust.id}
                    onClick={() => onSelectCustomer(cust)}
                    className={`w-full flex items-center space-x-2.5 px-3 py-2 text-left transition-colors ${
                      currentCustomer?.id === cust.id
                        ? 'bg-[#174B35] text-[#D5D9D3]'
                        : 'text-[#D5D9D3] hover:bg-[#1E211E]'
                    }`}
                  >
                    <img
                      src={cust.avatar}
                      alt={cust.name}
                      className="w-6 h-6 rounded-full object-cover shrink-0 grayscale"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate flex items-center justify-between">
                        <span>{cust.name}</span>
                        <span className="text-[10px] text-[#929A91] font-mono">{cust.order.orderId}</span>
                      </div>
                      <div className="text-[11px] text-[#929A91] truncate">{cust.order.product}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Simple Policies Button */}
          <button
            onClick={onOpenPolicies}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded text-xs text-[#929A91] hover:text-[#D5D9D3] bg-[#191A19] hover:bg-[#242724] border border-[#353B35] transition-colors"
            title="NovaCart Policies"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Policies</span>
          </button>
        </div>

      </div>
    </header>
  );
}

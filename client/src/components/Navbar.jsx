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
    <header className="sticky top-0 z-50 bg-[#0E0E0E] border-b border-[#222222] px-4 lg:px-6 h-13 flex items-center shrink-0">
      <div className="w-full flex items-center justify-between">
        
        {/* Left: Brand Identity */}
        <div className="flex items-center space-x-6">
          <Link to="/" className="flex items-center space-x-2.5 group">
            <div className="w-7 h-7 rounded bg-[#7CFF00] flex items-center justify-center text-[#090909] font-bold shadow-neon-sm">
              <MessageSquare className="w-4 h-4 fill-current stroke-current" />
            </div>
            <span className="font-bold text-sm tracking-tight text-[#FFFFFF]">
              Resolve <span className="text-[#7CFF00]">AI</span>
            </span>
          </Link>

          {/* Minimal Navigation */}
          <nav className="flex items-center space-x-1">
            <Link
              to="/customer"
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                isActive('/customer')
                  ? 'bg-[#7CFF00] text-[#090909] shadow-neon-sm'
                  : 'text-[#8A8A8A] hover:text-[#FFFFFF] hover:bg-[#1A1A1A]'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>Customer</span>
            </Link>

            <Link
              to="/agent"
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                isActive('/agent')
                  ? 'bg-[#7CFF00] text-[#090909] shadow-neon-sm'
                  : 'text-[#8A8A8A] hover:text-[#FFFFFF] hover:bg-[#1A1A1A]'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Agent</span>
            </Link>

            <Link
              to="/split"
              className={`hidden md:flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                isActive('/split')
                  ? 'bg-[#7CFF00] text-[#090909] shadow-neon-sm'
                  : 'text-[#8A8A8A] hover:text-[#FFFFFF] hover:bg-[#1A1A1A]'
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
              className="flex items-center space-x-2 bg-[#161616] hover:bg-[#202020] text-[#FFFFFF] border border-[#222222] hover:border-[#7CFF00]/40 px-2.5 py-1.5 rounded text-xs transition-colors"
            >
              <img
                src={currentCustomer?.avatar || DEMO_CUSTOMERS[0].avatar}
                alt={currentCustomer?.name}
                className="w-4 h-4 rounded-full object-cover grayscale"
              />
              <span className="font-medium text-[#FFFFFF]">{currentCustomer?.name || 'Customer'}</span>
              <span className="text-[11px] text-[#8A8A8A] font-mono">({currentCustomer?.order?.orderId})</span>
              <ChevronDown className="w-3.5 h-3.5 text-[#8A8A8A]" />
            </button>

            {dropdownOpen && (
              <div 
                className="absolute right-0 mt-1 w-64 bg-[#161616] border border-[#282828] rounded shadow-2xl py-1 z-50 text-xs"
                onClick={() => setDropdownOpen(false)}
              >
                <div className="px-3 py-1.5 text-[10px] font-semibold text-[#8A8A8A] uppercase tracking-wider border-b border-[#222222]">
                  Select Customer Account
                </div>
                {DEMO_CUSTOMERS.map((cust) => (
                  <button
                    key={cust.id}
                    onClick={() => onSelectCustomer(cust)}
                    className={`w-full flex items-center space-x-2.5 px-3 py-2 text-left transition-colors ${
                      currentCustomer?.id === cust.id
                        ? 'bg-[#7CFF00]/10 text-[#7CFF00] border-l-2 border-[#7CFF00]'
                        : 'text-[#FFFFFF] hover:bg-[#222222]'
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
                        <span className="text-[10px] text-[#8A8A8A] font-mono">{cust.order.orderId}</span>
                      </div>
                      <div className="text-[11px] text-[#8A8A8A] truncate">{cust.order.product}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Policies Button */}
          <button
            onClick={onOpenPolicies}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded text-xs text-[#8A8A8A] hover:text-[#FFFFFF] bg-[#161616] hover:bg-[#202020] border border-[#222222] hover:border-[#7CFF00]/40 transition-colors"
            title="NovaCart Policies"
          >
            <BookOpen className="w-3.5 h-3.5 text-[#7CFF00]" />
            <span className="hidden sm:inline">Policies</span>
          </button>
        </div>

      </div>
    </header>
  );
}

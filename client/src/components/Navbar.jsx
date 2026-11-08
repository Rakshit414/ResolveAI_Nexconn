import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  Bot, 
  User, 
  ShieldCheck, 
  Columns, 
  HelpCircle, 
  Sparkles,
  ExternalLink,
  ChevronDown
} from 'lucide-react';
import { DEMO_CUSTOMERS } from '../data/demoData';
import { checkHealth } from '../services/api';

export default function Navbar({ 
  currentCustomer, 
  onSelectCustomer, 
  onOpenPolicies 
}) {
  const location = useLocation();
  const [healthStatus, setHealthStatus] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    checkHealth()
      .then(setHealthStatus)
      .catch(() => setHealthStatus({ status: 'offline' }));
  }, []);

  const isActive = (path) => location.pathname === path;

  return (
    <header className="sticky top-0 z-50 bg-[#0B1120]/90 backdrop-blur-md border-b border-slate-800/80 px-4 lg:px-6 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Brand Logo & Tagline */}
        <div className="flex items-center space-x-3">
          <Link to="/" className="flex items-center space-x-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-indigo to-brand-violet flex items-center justify-center shadow-glow-sm group-hover:scale-105 transition-transform">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg tracking-tight text-white">Resolve<span className="text-brand-indigo">AI</span></span>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand-indigo/20 text-brand-indigo border border-brand-indigo/30">
                  Nexconn
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">From confusion to resolution, in one conversation.</p>
            </div>
          </Link>
        </div>

        {/* Navigation Mode Switcher */}
        <div className="flex items-center bg-slate-900/90 p-1 rounded-xl border border-slate-800 shadow-inner">
          <Link
            to="/customer"
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              isActive('/customer') || isActive('/')
                ? 'bg-brand-indigo text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Customer Portal</span>
          </Link>

          <Link
            to="/agent"
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              isActive('/agent')
                ? 'bg-brand-indigo text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Agent Dashboard</span>
          </Link>

          <Link
            to="/split"
            className={`hidden md:flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              isActive('/split')
                ? 'bg-brand-indigo text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
            title="Side-by-side view for real-time customer and agent live testing"
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Split Demo</span>
          </Link>
        </div>

        {/* Right Actions: Customer Switcher & Policies */}
        <div className="flex items-center space-x-2.5">
          {/* Customer Switcher */}
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center space-x-2 bg-slate-850 hover:bg-slate-800 text-slate-200 border border-slate-750 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            >
              <img
                src={currentCustomer?.avatar || DEMO_CUSTOMERS[0].avatar}
                alt={currentCustomer?.name}
                className="w-5 h-5 rounded-full object-cover border border-slate-700"
              />
              <span className="hidden sm:inline font-medium">{currentCustomer?.name || 'Aarav Sharma'}</span>
              <span className="text-[10px] text-slate-400 font-mono hidden md:inline">({currentCustomer?.order?.orderId})</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {dropdownOpen && (
              <div 
                className="absolute right-0 mt-2 w-72 bg-[#0F172A] border border-slate-750 rounded-xl shadow-2xl p-2 z-50 text-xs"
                onClick={() => setDropdownOpen(false)}
              >
                <div className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                  Select Demo Customer
                </div>
                {DEMO_CUSTOMERS.map((cust) => (
                  <button
                    key={cust.id}
                    onClick={() => onSelectCustomer(cust)}
                    className={`w-full flex items-center space-x-3 px-2.5 py-2 rounded-lg text-left transition-colors ${
                      currentCustomer?.id === cust.id
                        ? 'bg-brand-indigo/20 text-brand-indigo border border-brand-indigo/30'
                        : 'text-slate-300 hover:bg-slate-800/60'
                    }`}
                  >
                    <img
                      src={cust.avatar}
                      alt={cust.name}
                      className="w-8 h-8 rounded-full object-cover border border-slate-700"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-100 flex items-center justify-between">
                        <span>{cust.name}</span>
                        <span className="text-[10px] font-mono text-slate-400">{cust.order.orderId}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">{cust.order.reportedIssue}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Business Policies Modal Trigger */}
          <button
            onClick={onOpenPolicies}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-850 hover:bg-slate-800 border border-slate-750 transition-colors"
            title="NovaCart Business Knowledge Base & Policies"
          >
            <HelpCircle className="w-3.5 h-3.5 text-brand-indigo" />
            <span className="hidden lg:inline">Policies</span>
          </button>
        </div>
      </div>
    </header>
  );
}

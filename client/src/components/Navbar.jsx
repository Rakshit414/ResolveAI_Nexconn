import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ShieldCheck,
  User,
  Columns,
  BookOpen,
  ChevronDown,
  MessageSquare,
  Sparkles,
  ShoppingBag,
  Globe,
  Check
} from 'lucide-react';
import { DEMO_CUSTOMERS } from '../data/demoData';
import { useCart } from '../context/CartContext';
import { useLanguage } from '../context/LanguageContext';

export default function Navbar({
  currentCustomer,
  onSelectCustomer,
  onOpenPolicies
}) {
  const location = useLocation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const { itemCount, openCart } = useCart();
  const { language, setLanguage, supportedLanguages, storefront } = useLanguage();

  const nav = storefront?.nav || {};

  const isActive = (path) => {
    if (path === '/store') {
      return location.pathname === '/store' || location.pathname === '/';
    }
    return location.pathname === path;
  };

  const currentLangObj = supportedLanguages.find(l => l.code === language) || supportedLanguages[0];

  return (
    <header className="sticky top-0 z-50 bg-[#0A0A0A] border-b border-[#1C1C1C] px-4 md:px-6 h-16 flex items-center shrink-0">
      <div className="w-full flex items-center justify-between">

        {/* Left: Brand Identity & Product Tag */}
        <div className="flex items-center space-x-3 md:space-x-6">
          <Link to="/" className="flex items-center space-x-2.5 md:space-x-3 group">
            <div className="w-8 h-8 rounded-lg bg-[#7CFF00] flex items-center justify-center text-[#090909] font-black shadow-neon-sm group-hover:scale-105 transition-transform">
              <MessageSquare className="w-4 h-4 fill-current stroke-current" />
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-base tracking-tight text-[#FFFFFF] leading-none">
                Resolve<span className="text-[#7CFF00]">AI</span>
              </span>
              <span className="text-[10px] text-[#666666] tracking-wider uppercase font-medium mt-0.5">
                Nexconn Support Suite
              </span>
            </div>
          </Link>

          {/* Minimal Navigation Pills with ample breathing space */}
          <nav className="flex items-center space-x-1 md:space-x-2 pl-2 md:pl-4 border-l border-[#1C1C1C]">
            <Link
              to="/store"
              id="nav-link-store"
              className={`flex items-center space-x-1.5 md:space-x-2 px-2.5 md:px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                isActive('/store')
                  ? 'bg-[#7CFF00] text-[#090909] shadow-neon-sm font-bold'
                  : 'text-[#8A8A8A] hover:text-[#FFFFFF] hover:bg-[#161616]'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>{nav.storefront || 'Storefront'}</span>
            </Link>

            <Link
              to="/customer"
              id="nav-link-customer"
              className={`flex items-center space-x-1.5 md:space-x-2 px-2.5 md:px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                isActive('/customer')
                  ? 'bg-[#7CFF00] text-[#090909] shadow-neon-sm'
                  : 'text-[#8A8A8A] hover:text-[#FFFFFF] hover:bg-[#161616]'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>{nav.customer || 'Customer'}</span>
            </Link>

            <Link
              to="/agent"
              id="nav-link-agent"
              className={`flex items-center space-x-1.5 md:space-x-2 px-2.5 md:px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                isActive('/agent')
                  ? 'bg-[#7CFF00] text-[#090909] shadow-neon-sm'
                  : 'text-[#8A8A8A] hover:text-[#FFFFFF] hover:bg-[#161616]'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{nav.agent || 'Agent'}</span>
            </Link>

            <Link
              to="/split"
              id="nav-link-split"
              className={`hidden lg:flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                isActive('/split')
                  ? 'bg-[#7CFF00] text-[#090909] shadow-neon-sm'
                  : 'text-[#8A8A8A] hover:text-[#FFFFFF] hover:bg-[#161616]'
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
              <span>{nav.splitView || 'Split View'}</span>
            </Link>
          </nav>
        </div>

        {/* Right: Language Selector, Customer Switcher & Cart */}
        <div className="flex items-center space-x-2 md:space-x-3">

          {/* Storefront Language Selector (Desktop & Mobile) */}
          <div className="relative">
            <button
              id="btn-nav-language"
              onClick={() => {
                setLangDropdownOpen(!langDropdownOpen);
                setDropdownOpen(false);
              }}
              className="flex items-center space-x-1.5 bg-[#121212] hover:bg-[#181818] text-[#FFFFFF] border border-[#222222] hover:border-[#7CFF00]/50 px-2.5 py-1.5 rounded-lg text-xs transition-colors shadow-sm"
              title="Change Storefront Language"
              aria-label="Change Storefront Language"
            >
              <Globe className="w-3.5 h-3.5 text-[#7CFF00]" />
              <span className="font-semibold text-xs uppercase hidden sm:inline">{currentLangObj.code}</span>
              <span className="font-medium text-xs sm:hidden">{currentLangObj.native}</span>
              <ChevronDown className="w-3 h-3 text-[#8A8A8A]" />
            </button>

            {langDropdownOpen && (
              <div
                id="nav-language-dropdown"
                className="absolute right-0 mt-2 w-44 bg-[#121212] border border-[#242424] rounded-xl shadow-2xl py-1.5 z-50 text-xs animate-fadeIn"
              >
                <div className="px-3 py-1 text-[10px] font-bold text-[#666666] uppercase tracking-wider border-b border-[#1C1C1C]">
                  {nav.selectLanguage || 'Language'}
                </div>
                {supportedLanguages.map((lang) => {
                  const isSelected = language === lang.code;
                  return (
                    <button
                      key={lang.code}
                      id={`btn-lang-option-${lang.code}`}
                      onClick={() => {
                        setLanguage(lang.code);
                        setLangDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? 'bg-[#7CFF00]/10 text-[#7CFF00] font-bold'
                          : 'text-[#CCCCCC] hover:bg-[#1A1A1A] hover:text-[#FFFFFF]'
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">{lang.native}</span>
                        <span className="text-[10px] text-[#666666]">({lang.label})</span>
                      </div>
                      {isSelected && <Check className="w-3.5 h-3.5 text-[#7CFF00]" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Active Demo Customer Dropdown */}
          <div className="relative">
            <button
              id="btn-nav-customer-switcher"
              onClick={() => {
                setDropdownOpen(!dropdownOpen);
                setLangDropdownOpen(false);
              }}
              className="flex items-center space-x-2 bg-[#121212] hover:bg-[#181818] text-[#FFFFFF] border border-[#222222] hover:border-[#7CFF00]/50 px-2.5 md:px-3 py-1.5 rounded-lg text-xs transition-colors shadow-sm"
              title="Switch demo customer identity"
            >
              <img
                src={currentCustomer?.avatar || DEMO_CUSTOMERS[0].avatar}
                alt={currentCustomer?.name}
                className="w-5 h-5 rounded-full object-cover grayscale ring-1 ring-[#333333]"
              />
              <div className="hidden sm:flex items-center space-x-1.5">
                <span className="font-semibold text-[#FFFFFF] truncate max-w-[90px]">{currentCustomer?.name || 'Customer'}</span>
                <span className="text-[10px] text-[#7CFF00] font-mono">({currentCustomer?.order?.orderId})</span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-[#8A8A8A]" />
            </button>

            {dropdownOpen && (
              <div
                id="nav-customer-dropdown"
                className="absolute right-0 mt-2 w-72 bg-[#121212] border border-[#242424] rounded-xl shadow-2xl py-1.5 z-50 text-xs animate-fadeIn"
                onClick={() => setDropdownOpen(false)}
              >
                <div className="px-3.5 py-1.5 text-[10px] font-bold text-[#666666] uppercase tracking-wider border-b border-[#1C1C1C] flex items-center justify-between">
                  <span>{nav.switchCustomer || 'Switch Persona'}</span>
                  <span className="text-[#7CFF00] font-mono">Global Sync</span>
                </div>
                {DEMO_CUSTOMERS.map((cust) => {
                  const isSelected = currentCustomer?.id === cust.id;
                  return (
                    <button
                      key={cust.id}
                      id={`btn-persona-${cust.id}`}
                      onClick={() => onSelectCustomer(cust)}
                      className={`w-full flex items-center space-x-3 px-3.5 py-2.5 text-left transition-colors ${
                        isSelected
                          ? 'bg-[#7CFF00]/10 text-[#7CFF00] border-l-2 border-[#7CFF00]'
                          : 'text-[#FFFFFF] hover:bg-[#1A1A1A]'
                      }`}
                    >
                      <img
                        src={cust.avatar}
                        alt={cust.name}
                        className="w-7 h-7 rounded-full object-cover shrink-0 grayscale border border-[#282828]"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate flex items-center justify-between text-xs">
                          <span>{cust.name}</span>
                          <span className="text-[10px] text-[#7CFF00] font-mono">{cust.order.orderId}</span>
                        </div>
                        <div className="text-[11px] text-[#8A8A8A] truncate mt-0.5">{cust.order.product}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Universal Cart Button */}
          <button
            id="btn-nav-cart"
            onClick={openCart}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs bg-[#121212] hover:bg-[#181818] border border-[#222222] hover:border-[#7CFF00]/50 text-[#FFFFFF] transition-all group"
            title="Shopping Bag"
            aria-label="Open shopping bag"
          >
            <ShoppingBag className="w-3.5 h-3.5 text-[#7CFF00] group-hover:scale-110 transition-transform" />
            <span className="hidden sm:inline font-semibold">{nav.cart || 'Cart'}</span>
            <span
              id="nav-cart-badge-count"
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                itemCount > 0 ? 'bg-[#7CFF00] text-[#090909] font-black shadow-neon-sm' : 'bg-[#222222] text-[#777777]'
              }`}
            >
              {itemCount}
            </span>
          </button>

          {/* Policies Drawer Button */}
          <button
            id="btn-nav-policies"
            onClick={onOpenPolicies}
            className="flex items-center space-x-1.5 px-2.5 md:px-3 py-1.5 rounded-lg text-xs text-[#8A8A8A] hover:text-[#FFFFFF] bg-[#121212] hover:bg-[#181818] border border-[#222222] hover:border-[#7CFF00]/40 transition-colors"
            title="NovaCart Support Policies"
          >
            <BookOpen className="w-3.5 h-3.5 text-[#7CFF00]" />
            <span className="hidden sm:inline font-medium">{nav.policies || 'Policies'}</span>
          </button>
        </div>

      </div>
    </header>
  );
}

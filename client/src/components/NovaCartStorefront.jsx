import React, { useState, useEffect } from 'react';
import { 
  ShoppingBag, 
  Search, 
  Truck, 
  ShieldCheck, 
  RotateCcw, 
  Sparkles, 
  Star, 
  ChevronRight, 
  PackageSearch, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  Code, 
  ExternalLink,
  ChevronDown,
  User,
  Heart,
  SlidersHorizontal,
  X
} from 'lucide-react';
import { DEMO_CUSTOMERS } from '../data/demoData';
import EmbeddableWidget from './EmbeddableWidget';
import WidgetEmbedPreviewModal from './WidgetEmbedPreviewModal';
import CartDrawer from './CartDrawer';

// Complete Storefront Catalog
const CATALOG_PRODUCTS = [
  {
    id: "prod_shoes",
    name: "NovaSprint Pro Running Shoes",
    subtitle: "Engineered responsive cushioning with breathable mesh",
    category: "Footwear",
    price: 119.99,
    rating: 4.8,
    reviewsCount: 1248,
    image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=600&q=80",
    badge: "Best Seller",
    badgeColor: "bg-[#7CFF00] text-[#090909]",
    orderId: "NC1021",
    inStock: true,
    variants: ["Size 9 (US)", "Size 10 (US)", "Size 11 (US)"]
  },
  {
    id: "prod_watch",
    name: "NovaPulse Smartwatch - Obsidian",
    subtitle: "Titanium bezel, 7-day battery & advanced health metrics",
    category: "Wearables",
    price: 249.50,
    rating: 4.9,
    reviewsCount: 892,
    image: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=600&q=80",
    badge: "Staff Favorite",
    badgeColor: "bg-[#38BDF8] text-[#090909]",
    orderId: "NC1022",
    inStock: true,
    variants: ["42mm Obsidian", "46mm Obsidian"]
  },
  {
    id: "prod_headphones",
    name: "NovaBass ANC Wireless Headphones",
    subtitle: "Hybrid 40dB active noise cancellation with Hi-Res audio",
    category: "Audio",
    price: 89.00,
    rating: 4.7,
    reviewsCount: 2105,
    image: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80",
    badge: "Noise Cancelling",
    badgeColor: "bg-[#F59E0B] text-[#090909]",
    orderId: "NC1023",
    inStock: true,
    variants: ["Matte Black", "Arctic Silver"]
  },
  {
    id: "prod_flask",
    name: "NovaFit Vacuum Insulated Flask (750ml)",
    subtitle: "Double-wall 18/8 pro-grade stainless steel, keeps cold 24h",
    category: "Accessories",
    price: 34.99,
    rating: 4.9,
    reviewsCount: 640,
    image: "https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=600&q=80",
    badge: "In Stock",
    badgeColor: "bg-[#10B981] text-[#FFFFFF]",
    inStock: true,
    variants: ["750ml Stealth Black", "750ml Titanium Gray"]
  },
  {
    id: "prod_socks",
    name: "NovaGrip Merino Trail Socks (3-Pack)",
    subtitle: "Reinforced heel & toe, blister protection, anti-odor merino",
    category: "Footwear",
    price: 24.00,
    rating: 4.6,
    reviewsCount: 412,
    image: "https://images.unsplash.com/photo-1582966772680-860e372bb558?auto=format&fit=crop&w=600&q=80",
    badge: "3-Pack",
    badgeColor: "bg-[#8B5CF6] text-[#FFFFFF]",
    inStock: true,
    variants: ["Medium (US 7-9)", "Large (US 10-12)"]
  },
  {
    id: "prod_charger",
    name: "NovaCharge Dual 15W Qi Wireless Pad",
    subtitle: "Fast simultaneous induction charging for smartphone & watch",
    category: "Accessories",
    price: 45.00,
    rating: 4.8,
    reviewsCount: 310,
    image: "https://images.unsplash.com/photo-1586816879360-004f5b0c51e5?auto=format&fit=crop&w=600&q=80",
    badge: "Fast 15W",
    badgeColor: "bg-[#EC4899] text-[#FFFFFF]",
    inStock: true,
    variants: ["Obsidian Black", "Pure White"]
  }
];

const CART_STORAGE_KEY = 'novacart_storefront_cart';

const getInitialCart = () => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(CART_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter(item => 
            item && 
            typeof item.id === 'string' && 
            typeof item.price === 'number' && 
            typeof item.quantity === 'number' && 
            item.quantity > 0
          );
        }
      }
    }
  } catch (e) {
    console.warn('[NovaCart Storefront] Error reading cart from localStorage:', e);
  }

  // Default initial cart: 2 items matching initial demo badge
  return [
    {
      id: "prod_shoes",
      variantId: "prod_shoes_Size 10 (US)",
      name: "NovaSprint Pro Running Shoes",
      price: 119.99,
      quantity: 1,
      image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=600&q=80",
      variant: "Size 10 (US)"
    },
    {
      id: "prod_charger",
      variantId: "prod_charger_Obsidian Black",
      name: "NovaCharge Dual 15W Qi Wireless Pad",
      price: 45.00,
      quantity: 1,
      image: "https://images.unsplash.com/photo-1586816879360-004f5b0c51e5?auto=format&fit=crop&w=600&q=80",
      variant: "Obsidian Black"
    }
  ];
};

export default function NovaCartStorefront({
  currentCustomer,
  onSelectCustomer
}) {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [isWidgetOpen, setIsWidgetOpen] = useState(false);
  const [isEmbedModalOpen, setIsEmbedModalOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [cart, setCart] = useState(getInitialCart);
  const [selectedVariants, setSelectedVariants] = useState({});
  const [addedFeedback, setAddedFeedback] = useState({});
  const [lookupOrderNumber, setLookupOrderNumber] = useState(currentCustomer?.order?.orderId || 'NC1021');
  const [activeOrderView, setActiveOrderView] = useState(currentCustomer?.order || DEMO_CUSTOMERS[0].order);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);

  // Sync cart to localStorage whenever cart state changes
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
      }
    } catch (e) {
      console.warn('[NovaCart Storefront] Error persisting cart to localStorage:', e);
    }
  }, [cart]);

  // Dynamic total item count for cart badge
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // Add product to cart without creating duplicate entries for identical product and variant
  const handleAddToCart = (product, chosenVariant) => {
    const variant = chosenVariant || product.variants?.[0] || 'Standard';
    const variantId = `${product.id}_${variant}`;

    setCart(prevCart => {
      const existingIdx = prevCart.findIndex(item => item.variantId === variantId);
      if (existingIdx > -1) {
        const next = [...prevCart];
        next[existingIdx] = {
          ...next[existingIdx],
          quantity: next[existingIdx].quantity + 1
        };
        return next;
      } else {
        return [
          ...prevCart,
          {
            id: product.id,
            variantId,
            name: product.name,
            price: product.price,
            quantity: 1,
            image: product.image,
            variant
          }
        ];
      }
    });

    // Provide instant visual confirmation on card
    setAddedFeedback(prev => ({ ...prev, [product.id]: true }));
    setTimeout(() => {
      setAddedFeedback(prev => ({ ...prev, [product.id]: false }));
    }, 1400);
  };

  // Stepper quantity update (+1 / -1)
  const handleUpdateQuantity = (variantId, delta) => {
    setCart(prevCart => {
      return prevCart
        .map(item => {
          if (item.variantId === variantId) {
            const nextQty = item.quantity + delta;
            return nextQty > 0 ? { ...item, quantity: nextQty } : null;
          }
          return item;
        })
        .filter(Boolean);
    });
  };

  // Remove individual line item
  const handleRemoveItem = (variantId) => {
    setCart(prevCart => prevCart.filter(item => item.variantId !== variantId));
  };

  // Clear all cart items
  const handleClearCart = () => {
    setCart([]);
  };

  // Filter products
  const filteredProducts = CATALOG_PRODUCTS.filter(p => {
    const matchesCat = selectedCategory === 'All' || p.category === selectedCategory;
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.subtitle.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  // Handle order chip selection
  const handleSelectOrderChip = (cust) => {
    if (onSelectCustomer) {
      onSelectCustomer(cust);
    }
    setActiveOrderView(cust.order);
    setLookupOrderNumber(cust.order.orderId);
  };

  // Open support widget with preloaded order
  const handleLaunchSupportForOrder = () => {
    setIsWidgetOpen(true);
  };

  return (
    <div className="h-full overflow-y-auto bg-[#080808] text-[#FFFFFF] font-sans selection:bg-[#7CFF00] selection:text-[#090909]">
      
      {/* 1. Top Announcement Bar */}
      <div className="bg-[#111111] border-b border-[#1E1E1E] text-xs py-2 px-4 flex items-center justify-between text-[#888888]">
        <div className="hidden sm:flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-[#7CFF00] animate-pulse"></span>
          <span className="text-[#AAAAAA] font-medium">⚡ FREE EXPRESS SHIPPING OVER $75 • 7-DAY HASSLE-FREE RETURNS</span>
        </div>
        <div className="w-full sm:w-auto flex items-center justify-between sm:justify-end space-x-4 text-[11px]">
          <span className="text-[#7CFF00] font-semibold">24/7 AI-Assisted Resolution</span>
          <span>•</span>
          <button 
            onClick={() => setIsEmbedModalOpen(true)}
            className="text-[#888888] hover:text-[#FFFFFF] flex items-center space-x-1 underline decoration-dotted transition-colors"
          >
            <Code className="w-3 h-3 text-[#7CFF00]" />
            <span>Embed Widget Snippet</span>
          </button>
        </div>
      </div>

      {/* 2. Storefront Main Header */}
      <header className="sticky top-0 z-40 bg-[#0C0C0C]/95 backdrop-blur border-b border-[#1C1C1C] px-4 md:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          
          {/* Logo & Brand Identity */}
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-[#7CFF00] flex items-center justify-center text-[#090909] font-black shadow-neon-sm">
              <ShoppingBag className="w-5 h-5 fill-current stroke-current" />
            </div>
            <div>
              <span className="font-extrabold text-lg tracking-tight text-[#FFFFFF]">
                Nova<span className="text-[#7CFF00]">Cart</span>
              </span>
              <span className="hidden lg:inline-block ml-2 text-[10px] px-2 py-0.5 rounded-full bg-[#181818] border border-[#282828] text-[#888888] uppercase font-semibold tracking-wider">
                Official Store
              </span>
            </div>
          </div>

          {/* Search Bar */}
          <div className="hidden md:flex flex-1 max-w-md relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#666666]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search performance footwear, smart gear, audio..."
              className="w-full bg-[#141414] text-xs text-[#FFFFFF] pl-9 pr-4 py-2 rounded-xl border border-[#222222] focus:border-[#7CFF00] focus:outline-none placeholder-[#555555] transition-colors"
            />
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center space-x-3">
            
            {/* Customer Identity Selector Dropdown */}
            <div className="relative">
              <button
                onClick={() => setCustomerDropdownOpen(!customerDropdownOpen)}
                className="flex items-center space-x-2 bg-[#141414] hover:bg-[#1A1A1A] border border-[#222222] hover:border-[#7CFF00]/50 px-3 py-1.5 rounded-xl text-xs transition-colors"
              >
                <img 
                  src={currentCustomer?.avatar || DEMO_CUSTOMERS[0].avatar} 
                  alt={currentCustomer?.name} 
                  className="w-5 h-5 rounded-full object-cover border border-[#333333]"
                />
                <span className="hidden sm:inline font-medium text-[#CCCCCC]">
                  {currentCustomer?.name}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-[#666666]" />
              </button>

              {customerDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-[#141414] border border-[#2A2A2A] rounded-xl shadow-2xl p-2 z-50 animate-fade-in">
                  <div className="text-[10px] uppercase font-bold text-[#666666] px-2 py-1 tracking-wider">
                    Switch Demo Customer
                  </div>
                  {DEMO_CUSTOMERS.map(cust => (
                    <button
                      key={cust.id}
                      onClick={() => {
                        handleSelectOrderChip(cust);
                        setCustomerDropdownOpen(false);
                      }}
                      className={`w-full text-left p-2 rounded-lg flex items-center space-x-2.5 transition-colors ${
                        currentCustomer?.id === cust.id ? 'bg-[#7CFF00]/10 border border-[#7CFF00]/30' : 'hover:bg-[#1F1F1F]'
                      }`}
                    >
                      <img src={cust.avatar} alt={cust.name} className="w-7 h-7 rounded-full object-cover" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#FFFFFF] truncate">{cust.name}</p>
                        <p className="text-[10px] text-[#888888] font-mono">Order #{cust.order.orderId} • {cust.order.carrier}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Cart Button */}
            <button 
              id="btn-cart-toggle"
              onClick={() => setIsCartOpen(true)}
              className="relative p-2 rounded-xl bg-[#141414] hover:bg-[#1A1A1A] border border-[#222222] hover:border-[#7CFF00]/50 text-[#CCCCCC] hover:text-[#FFFFFF] transition-all group"
              title="Shopping Bag"
              aria-label="Open shopping bag"
            >
              <ShoppingBag className="w-4 h-4 text-[#7CFF00] group-hover:scale-110 transition-transform" />
              <span 
                id="cart-badge-count" 
                className={`absolute -top-1 -right-1 w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center transition-all ${
                  cartCount > 0 ? 'bg-[#7CFF00] text-[#090909] shadow-neon-sm font-extrabold' : 'bg-[#222222] text-[#777777]'
                }`}
              >
                {cartCount}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* 3. Hero Section */}
      <section className="relative overflow-hidden border-b border-[#1C1C1C] bg-gradient-to-b from-[#111111] via-[#0C0C0C] to-[#080808] px-4 md:px-8 py-12 md:py-16">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          <div className="lg:col-span-7 space-y-5">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-[#7CFF00]/10 border border-[#7CFF00]/25 text-[#7CFF00] text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Spring Performance 2026 Collection</span>
            </div>

            <h1 className="text-3xl md:text-5xl font-black tracking-tight text-[#FFFFFF] leading-tight">
              Engineered for Movement. <br />
              <span className="text-[#7CFF00]">Backed by Real-Time AI Support.</span>
            </h1>

            <p className="text-sm md:text-base text-[#AAAAAA] max-w-xl leading-relaxed">
              Experience responsive running footwear, titanium smart wearables, and hybrid ANC audio. Seamlessly integrated with Resolve AI for zero-wait parcel tracking, instant replacements, and human escalation.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button 
                onClick={() => setSelectedCategory('Footwear')}
                className="px-5 py-2.5 rounded-xl bg-[#7CFF00] hover:bg-[#6BE000] text-[#090909] font-bold text-xs shadow-neon-sm transition-all"
              >
                Shop Footwear
              </button>
              <button 
                onClick={() => {
                  const el = document.getElementById('order-tracker');
                  el?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="px-5 py-2.5 rounded-xl bg-[#181818] hover:bg-[#222222] text-[#FFFFFF] font-semibold text-xs border border-[#2E2E2E] transition-all"
              >
                Track Existing Shipment
              </button>
            </div>

            {/* Value Proposition Pills */}
            <div className="grid grid-cols-3 gap-3 pt-4 border-t border-[#1E1E1E] text-xs text-[#888888]">
              <div className="flex items-center space-x-2">
                <Truck className="w-4 h-4 text-[#7CFF00]" />
                <span>4–6 Day Delivery</span>
              </div>
              <div className="flex items-center space-x-2">
                <RotateCcw className="w-4 h-4 text-[#38BDF8]" />
                <span>7-Day Return Window</span>
              </div>
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-[#10B981]" />
                <span>Verified AI Resolution</span>
              </div>
            </div>
          </div>

          {/* Hero Featured Product Showcase */}
          <div className="lg:col-span-5 relative">
            <div className="rounded-2xl border border-[#262626] bg-[#121212] p-5 shadow-2xl relative overflow-hidden group">
              <div className="absolute top-4 right-4 z-10">
                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#7CFF00] text-[#090909] shadow-sm">
                  Featured
                </span>
              </div>
              <div className="w-full h-56 rounded-xl overflow-hidden mb-4 bg-[#0A0A0A]">
                <img 
                  src="https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=600&q=80" 
                  alt="NovaSprint Pro" 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-base text-[#FFFFFF]">NovaSprint Pro Running Shoes</h3>
                  <p className="text-xs text-[#888888]">Order #NC1021 • Blue/Grey</p>
                </div>
                <div className="text-right">
                  <p className="text-base font-extrabold text-[#7CFF00]">$119.99</p>
                  <p className="text-[10px] text-[#666666]">FedEx Express</p>
                </div>
              </div>

              {/* Instant Chat Trigger */}
              <div className="mt-4 pt-4 border-t border-[#1E1E1E] flex items-center justify-between">
                <span className="text-[11px] text-[#AAAAAA]">Delayed in transit?</span>
                <button
                  onClick={() => {
                    handleSelectOrderChip(DEMO_CUSTOMERS[0]);
                    setIsWidgetOpen(true);
                  }}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#7CFF00]/10 hover:bg-[#7CFF00]/20 text-[#7CFF00] border border-[#7CFF00]/30 text-xs font-semibold transition-all"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Ask Support AI</span>
                </button>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* 4. Interactive Order Tracker / Look-up Section */}
      <section id="order-tracker" className="border-b border-[#1C1C1C] bg-[#0E0E0E] px-4 md:px-8 py-10">
        <div className="max-w-7xl mx-auto">
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center space-x-2 text-xs font-semibold text-[#7CFF00] uppercase tracking-wider">
                <PackageSearch className="w-4 h-4" />
                <span>Live Courier Tracking & Resolution</span>
              </div>
              <h2 className="text-xl md:text-2xl font-black text-[#FFFFFF] mt-1">
                Track Your NovaCart Shipment
              </h2>
            </div>

            {/* Quick Demo Customer Order Chips */}
            <div className="flex items-center space-x-2 overflow-x-auto no-scrollbar">
              <span className="text-xs text-[#666666] shrink-0">Demo Orders:</span>
              {DEMO_CUSTOMERS.map(cust => (
                <button
                  key={cust.id}
                  onClick={() => handleSelectOrderChip(cust)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all shrink-0 ${
                    currentCustomer?.id === cust.id
                      ? 'bg-[#7CFF00] text-[#090909] border-[#7CFF00] shadow-sm'
                      : 'bg-[#161616] text-[#CCCCCC] border-[#2A2A2A] hover:bg-[#202020]'
                  }`}
                >
                  #{cust.order.orderId} ({cust.name.split(' ')[0]})
                </button>
              ))}
            </div>
          </div>

          {/* Active Order Live Context Card */}
          {activeOrderView && (
            <div className="bg-[#141414] border border-[#222222] rounded-2xl p-5 md:p-6 shadow-xl grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              
              <div className="lg:col-span-4 flex items-center space-x-4">
                <img 
                  src={activeOrderView.image} 
                  alt={activeOrderView.product} 
                  className="w-20 h-20 rounded-xl object-cover border border-[#2E2E2E] shrink-0"
                />
                <div className="min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-sm text-[#FFFFFF] truncate">
                      {activeOrderView.product}
                    </span>
                  </div>
                  <p className="text-xs text-[#888888] mt-0.5">Order #{activeOrderView.orderId} • ${activeOrderView.price.toFixed(2)} USD</p>
                  <p className="text-[11px] text-[#666666] mt-1">Carrier: <strong className="text-[#CCCCCC]">{activeOrderView.carrier}</strong></p>
                </div>
              </div>

              <div className="lg:col-span-5 space-y-1.5 border-y lg:border-y-0 lg:border-x border-[#222222] py-3 lg:py-0 lg:px-6">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#888888]">Tracking Code:</span>
                  <code className="text-[#7CFF00] font-mono font-bold">{activeOrderView.trackingNumber}</code>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#888888]">Status:</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    activeOrderView.status === 'Delayed'
                      ? 'bg-[#FF3366]/20 text-[#FF3366] border border-[#FF3366]/30'
                      : 'bg-[#7CFF00]/20 text-[#7CFF00] border border-[#7CFF00]/30'
                  }`}>
                    {activeOrderView.status}
                  </span>
                </div>
                <p className="text-[11px] text-[#AAAAAA] italic pt-1 leading-tight">
                  "{activeOrderView.trackingStatus}"
                </p>
              </div>

              <div className="lg:col-span-3 flex flex-col justify-center space-y-2">
                <button
                  onClick={handleLaunchSupportForOrder}
                  className="w-full py-2.5 px-4 rounded-xl bg-[#7CFF00] hover:bg-[#6BE000] text-[#090909] font-bold text-xs flex items-center justify-center space-x-2 shadow-neon-sm transition-all"
                >
                  <Sparkles className="w-4 h-4 fill-current stroke-current" />
                  <span>Launch Support Chat</span>
                </button>
                <p className="text-[10px] text-center text-[#666666]">
                  Pre-loads #{activeOrderView.orderId} context directly into Resolve AI
                </p>
              </div>

            </div>
          )}

        </div>
      </section>

      {/* 5. Product Catalog Section */}
      <section className="px-4 md:px-8 py-12 max-w-7xl mx-auto">
        
        {/* Category Filter Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h2 className="text-xl md:text-2xl font-black text-[#FFFFFF]">
              NovaCart Product Catalog
            </h2>
            <p className="text-xs text-[#888888] mt-1">
              Select any item to view specifications or inquire with conversational support
            </p>
          </div>

          <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar">
            {['All', 'Footwear', 'Wearables', 'Audio', 'Accessories'].map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all shrink-0 ${
                  selectedCategory === cat 
                    ? 'bg-[#7CFF00] text-[#090909] font-bold shadow-neon-sm' 
                    : 'bg-[#141414] text-[#888888] hover:text-[#FFFFFF] border border-[#222222]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Product Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProducts.map(product => (
            <div 
              key={product.id}
              className="bg-[#121212] border border-[#222222] hover:border-[#7CFF00]/40 rounded-2xl p-4 flex flex-col justify-between transition-all hover:shadow-2xl group"
            >
              <div>
                {/* Thumbnail & Badge */}
                <div className="relative w-full h-52 rounded-xl overflow-hidden mb-3 bg-[#0A0A0A]">
                  <img 
                    src={product.image} 
                    alt={product.name} 
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute top-3 left-3">
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${product.badgeColor}`}>
                      {product.badge}
                    </span>
                  </div>
                </div>

                {/* Rating & Reviews */}
                <div className="flex items-center space-x-1.5 text-xs text-[#888888] mb-1">
                  <div className="flex text-[#F59E0B]">
                    <Star className="w-3.5 h-3.5 fill-current" />
                  </div>
                  <span className="font-bold text-[#FFFFFF]">{product.rating}</span>
                  <span>({product.reviewsCount} reviews)</span>
                </div>

                {/* Title & Subtitle */}
                <h3 className="font-bold text-sm text-[#FFFFFF] group-hover:text-[#7CFF00] transition-colors">
                  {product.name}
                </h3>
                <p className="text-xs text-[#888888] mt-1 line-clamp-2 leading-relaxed">
                  {product.subtitle}
                </p>
              </div>

              {/* Price & Actions */}
              <div className="mt-4 pt-3 border-t border-[#1C1C1C]">
                {/* Variant Selector */}
                {product.variants && (
                  <div className="mb-2.5 flex items-center justify-between text-[11px]">
                    <span className="text-[#666666]">Option:</span>
                    <select
                      id={`select-variant-${product.id}`}
                      value={selectedVariants[product.id] || product.variants[0]}
                      onChange={(e) => setSelectedVariants({ ...selectedVariants, [product.id]: e.target.value })}
                      className="bg-[#181818] hover:bg-[#202020] text-[#DDDDDD] text-[11px] rounded-lg px-2 py-0.5 border border-[#2A2A2A] focus:border-[#7CFF00] focus:outline-none transition-colors cursor-pointer"
                    >
                      {product.variants.map(v => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex items-center justify-between mb-3">
                  <div>
                    <span className="text-base font-black text-[#FFFFFF]">
                      ${product.price.toFixed(2)}
                    </span>
                    <span className="text-[10px] text-[#666666] ml-1">USD</span>
                  </div>
                  <span className="text-[11px] text-[#10B981] font-medium">In Stock</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    id={`btn-add-to-cart-${product.id}`}
                    onClick={() => handleAddToCart(product, selectedVariants[product.id] || product.variants?.[0])}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all flex items-center justify-center space-x-1.5 ${
                      addedFeedback[product.id]
                        ? 'bg-[#7CFF00] text-[#090909] border-[#7CFF00] font-bold shadow-neon-sm'
                        : 'bg-[#1A1A1A] hover:bg-[#242424] text-[#FFFFFF] border-[#2E2E2E] hover:border-[#7CFF00]/40'
                    }`}
                  >
                    {addedFeedback[product.id] ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Added ✓</span>
                      </>
                    ) : (
                      <span>Add to Cart</span>
                    )}
                  </button>

                  <button
                    onClick={() => {
                      // If associated with a demo order, select that customer
                      const matched = DEMO_CUSTOMERS.find(c => c.order.orderId === product.orderId);
                      if (matched) {
                        handleSelectOrderChip(matched);
                      }
                      setIsWidgetOpen(true);
                    }}
                    className="py-2 px-3 rounded-xl bg-[#7CFF00]/10 hover:bg-[#7CFF00]/20 text-[#7CFF00] border border-[#7CFF00]/30 text-xs font-semibold flex items-center justify-center space-x-1 transition-colors"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Inquire AI</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

      </section>

      {/* 6. Brand Policies & Customer Guarantees */}
      <section className="border-t border-[#1C1C1C] bg-[#0C0C0C] px-4 md:px-8 py-12">
        <div className="max-w-7xl mx-auto">
          
          <div className="text-center max-w-2xl mx-auto mb-10">
            <span className="text-xs font-bold text-[#7CFF00] uppercase tracking-wider">
              NovaCart Trust & Support Guarantees
            </span>
            <h2 className="text-2xl font-black text-[#FFFFFF] mt-1">
              Automated Policy Enforcement
            </h2>
            <p className="text-xs text-[#888888] mt-2">
              Every policy rule is directly evaluated by Resolve AI to provide consistent, audit-compliant resolutions.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-[#121212] border border-[#1E1E1E] rounded-xl p-4 space-y-2">
              <Truck className="w-5 h-5 text-[#7CFF00]" />
              <h4 className="font-bold text-xs text-[#FFFFFF]">4–6 Days Dispatch</h4>
              <p className="text-[11px] text-[#888888] leading-relaxed">
                Standard delivery within 4–6 business days with verified FedEx, UPS, or DHL tracking updates.
              </p>
            </div>

            <div className="bg-[#121212] border border-[#1E1E1E] rounded-xl p-4 space-y-2">
              <RotateCcw className="w-5 h-5 text-[#38BDF8]" />
              <h4 className="font-bold text-xs text-[#FFFFFF]">7-Day Return Window</h4>
              <p className="text-[11px] text-[#888888] leading-relaxed">
                Initiate hassle-free returns within 7 calendar days of confirmed delivery for immediate refund review.
              </p>
            </div>

            <div className="bg-[#121212] border border-[#1E1E1E] rounded-xl p-4 space-y-2">
              <AlertTriangle className="w-5 h-5 text-[#F59E0B]" />
              <h4 className="font-bold text-xs text-[#FFFFFF]">Damaged Item Replacement</h4>
              <p className="text-[11px] text-[#888888] leading-relaxed">
                Damaged or incorrect shipments qualify for instant free replacement upon photo proof verification.
              </p>
            </div>

            <div className="bg-[#121212] border border-[#1E1E1E] rounded-xl p-4 space-y-2">
              <ShieldCheck className="w-5 h-5 text-[#10B981]" />
              <h4 className="font-bold text-xs text-[#FFFFFF]">Human Agent Escalation</h4>
              <p className="text-[11px] text-[#888888] leading-relaxed">
                One-click handoff to Senior Support Specialist Sarah Lin with full context & conversation history.
              </p>
            </div>
          </div>

        </div>
      </section>

      {/* 7. SaaS Embed & Integration Banner */}
      <section className="border-t border-[#1C1C1C] bg-[#101010] px-4 md:px-8 py-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <Code className="w-4 h-4 text-[#7CFF00]" />
              <span className="font-bold text-sm text-[#FFFFFF]">Integrate Resolve AI on Your Own Storefront</span>
            </div>
            <p className="text-xs text-[#888888]">
              Embeddable support widget powered by PostgreSQL, Gemini AI, and Nexconn real-time messaging.
            </p>
          </div>

          <button
            onClick={() => setIsEmbedModalOpen(true)}
            className="px-4 py-2 rounded-xl bg-[#7CFF00] hover:bg-[#6BE000] text-[#090909] font-bold text-xs flex items-center space-x-2 shadow-neon-sm transition-all"
          >
            <span>View Script Snippet & Theming</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>

      {/* 8. Storefront Footer */}
      <footer className="border-t border-[#1C1C1C] bg-[#080808] text-[#666666] text-xs px-4 md:px-8 py-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 NovaCart Inc. All rights reserved. Powered by Resolve AI Support Suite.</p>
          <div className="flex items-center space-x-4">
            <a href="#policies" className="hover:text-[#FFFFFF] transition-colors">Privacy</a>
            <a href="#policies" className="hover:text-[#FFFFFF] transition-colors">Terms of Service</a>
            <a href="#policies" className="hover:text-[#FFFFFF] transition-colors">Security</a>
          </div>
        </div>
      </footer>

      {/* 9. Floating Resolve AI Support Widget */}
      <EmbeddableWidget
        brandId="brand_novacart"
        customer={currentCustomer}
        onSelectCustomer={onSelectCustomer}
        isOpen={isWidgetOpen}
        onToggle={() => setIsWidgetOpen(!isWidgetOpen)}
      />

      {/* 10. Embed Snippet & Brand Theming Modal */}
      {isEmbedModalOpen && (
        <WidgetEmbedPreviewModal
          isOpen={isEmbedModalOpen}
          onClose={() => setIsEmbedModalOpen(false)}
        />
      )}

      {/* 11. Shopping Bag Drawer & Demo Checkout */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cart={cart}
        onUpdateQuantity={handleUpdateQuantity}
        onRemoveItem={handleRemoveItem}
        onClearCart={handleClearCart}
        onOpenSupportForOrder={(orderId) => {
          setLookupOrderNumber(orderId);
          setIsWidgetOpen(true);
        }}
      />

    </div>
  );
}

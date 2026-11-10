import React, { useState, useEffect } from 'react';
import { 
  ShoppingBag, 
  X, 
  Plus, 
  Minus, 
  Trash2, 
  ArrowRight, 
  CheckCircle2, 
  Truck, 
  ShieldCheck, 
  Sparkles, 
  RotateCcw,
  Package,
  AlertCircle
} from 'lucide-react';

export default function CartDrawer({
  isOpen,
  onClose,
  cart = [],
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  onOpenSupportForOrder
}) {
  const [checkoutStep, setCheckoutStep] = useState('cart'); // 'cart' | 'checkout' | 'confirmation'
  const [shippingInfo, setShippingInfo] = useState({
    fullName: '',
    email: '',
    address: '',
    city: '',
    postalCode: '',
    deliveryMethod: 'express'
  });
  const [confirmedOrder, setConfirmedOrder] = useState(null);
  const [formErrors, setFormErrors] = useState({});

  // Reset checkout view when drawer re-opens (unless confirmation is active)
  useEffect(() => {
    if (isOpen) {
      if (!confirmedOrder) {
        setCheckoutStep('cart');
      }
    }
  }, [isOpen, confirmedOrder]);

  // Handle Escape key to close drawer
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Calculate totals
  const totalItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const freeShippingThreshold = 75.00;
  const isFreeShipping = subtotal >= freeShippingThreshold;
  const shippingCost = cart.length === 0 ? 0 : (isFreeShipping ? 0 : 5.00);
  const estimatedTax = 0.00; // Tax included or demo 0
  const grandTotal = subtotal + shippingCost + estimatedTax;

  // Auto-fill demo details
  const handleAutoFillDemo = () => {
    setShippingInfo({
      fullName: 'Alex Morgan',
      email: 'alex.morgan@novacart.demo',
      address: '742 Evergreen Terrace, Suite 100',
      city: 'Seattle',
      postalCode: '98101',
      deliveryMethod: 'express'
    });
    setFormErrors({});
  };

  // Place demo order
  const handlePlaceOrder = (e) => {
    e?.preventDefault();
    const errors = {};
    if (!shippingInfo.fullName.trim()) errors.fullName = 'Full name is required';
    if (!shippingInfo.email.trim() || !shippingInfo.email.includes('@')) errors.email = 'Valid email is required';
    if (!shippingInfo.address.trim()) errors.address = 'Street address is required';
    if (!shippingInfo.city.trim()) errors.city = 'City is required';

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    const orderId = `NC2026-${Math.floor(1000 + Math.random() * 9000)}`;
    const placedOrder = {
      orderId,
      placedAt: new Date().toISOString(),
      items: [...cart],
      itemCount: totalItemCount,
      subtotal,
      shippingCost,
      grandTotal,
      shippingInfo: { ...shippingInfo },
      trackingNumber: `TRK-NC-${Math.floor(100000 + Math.random() * 900000)}`,
      carrier: 'FedEx Express Priority',
      estimatedDelivery: '3–4 Business Days'
    };

    setConfirmedOrder(placedOrder);
    setCheckoutStep('confirmation');
    onClearCart(); // Empty the cart upon verified checkout completion
  };

  // Return to shopping from confirmation
  const handleFinishConfirmation = () => {
    setConfirmedOrder(null);
    setCheckoutStep('cart');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden animate-fadeIn" role="dialog" aria-modal="true" aria-labelledby="cart-heading">
      {/* 1. Backdrop Overlay (Click to close) */}
      <div 
        onClick={onClose}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
      />

      {/* 2. Slide-over Container (Right on desktop, full-screen on mobile) */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-0 sm:pl-10">
        <div className="w-screen sm:w-[460px] max-w-full bg-[#0D0D0D] border-l border-[#222222] shadow-2xl flex flex-col justify-between text-[#FFFFFF] animate-slideInRight">
          
          {/* =================================================================
              TOP DRAWER HEADER
              ================================================================= */}
          <div className="px-6 py-4 bg-[#111111] border-b border-[#1E1E1E] flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#7CFF00]/10 border border-[#7CFF00]/30 flex items-center justify-center text-[#7CFF00]">
                <ShoppingBag className="w-4 h-4" />
              </div>
              <div>
                <h2 id="cart-heading" className="font-extrabold text-sm text-[#FFFFFF] tracking-tight">
                  {checkoutStep === 'cart' ? 'Your Shopping Bag' : checkoutStep === 'checkout' ? 'Demo Checkout' : 'Order Confirmed'}
                </h2>
                <p className="text-[11px] text-[#888888] font-mono">
                  {checkoutStep === 'cart' ? `${totalItemCount} ${totalItemCount === 1 ? 'item' : 'items'} in bag` : 'NovaCart Official Store'}
                </p>
              </div>
            </div>

            <button
              id="btn-close-cart"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#888888] hover:text-[#FFFFFF] bg-[#181818] hover:bg-[#222222] border border-[#282828] transition-colors"
              title="Close bag (Esc)"
              aria-label="Close shopping bag"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* =================================================================
              VIEW 1: CART CONTENTS & LINE ITEMS
              ================================================================= */}
          {checkoutStep === 'cart' && (
            <>
              {/* Free Express Shipping Meter */}
              {cart.length > 0 && (
                <div className="px-6 py-2.5 bg-[#141414] border-b border-[#1E1E1E] text-xs">
                  {isFreeShipping ? (
                    <div className="flex items-center space-x-2 text-[#7CFF00] font-semibold text-[11px]">
                      <Truck className="w-3.5 h-3.5 shrink-0" />
                      <span>⚡ You've unlocked FREE Express Shipping!</span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-[#AAAAAA]">
                        <span>Add ${(freeShippingThreshold - subtotal).toFixed(2)} more for FREE Express Shipping</span>
                        <span className="font-mono text-[#7CFF00] font-bold">{Math.round((subtotal / freeShippingThreshold) * 100)}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-[#222222] rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-[#7CFF00] rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, (subtotal / freeShippingThreshold) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Scrollable Items Container */}
              <div className="flex-1 overflow-y-auto px-6 py-4 divide-y divide-[#1A1A1A]">
                {cart.length === 0 ? (
                  /* Empty Cart State */
                  <div className="h-full flex flex-col items-center justify-center text-center py-12 px-4 space-y-4 animate-fadeIn">
                    <div className="w-16 h-16 rounded-2xl bg-[#141414] border border-[#242424] flex items-center justify-center text-[#555555]">
                      <ShoppingBag className="w-8 h-8 stroke-1 text-[#666666]" />
                    </div>
                    <div className="space-y-1.5 max-w-xs">
                      <h3 className="font-bold text-base text-[#FFFFFF]">Your bag is empty</h3>
                      <p className="text-xs text-[#888888] leading-relaxed">
                        Explore our high-performance running shoes, titanium wearables, and hybrid ANC audio.
                      </p>
                    </div>
                    <button
                      id="btn-continue-shopping"
                      onClick={onClose}
                      className="mt-2 px-5 py-2.5 rounded-xl bg-[#7CFF00] hover:bg-[#6BE000] text-[#090909] font-bold text-xs shadow-neon-sm transition-all"
                    >
                      Continue Shopping
                    </button>
                  </div>
                ) : (
                  /* Active Cart Items */
                  cart.map((item) => (
                    <div key={item.variantId || `${item.id}_${item.variant}`} className="py-4 first:pt-0 last:pb-0 flex items-start space-x-3.5">
                      {/* Product Thumbnail */}
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-16 h-16 rounded-xl object-cover bg-[#090909] border border-[#222222] shrink-0"
                      />

                      {/* Product Metadata & Actions */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-bold text-xs text-[#FFFFFF] truncate leading-snug" title={item.name}>
                            {item.name}
                          </h4>
                          <button
                            id={`btn-remove-${item.variantId || item.id}`}
                            onClick={() => onRemoveItem(item.variantId || `${item.id}_${item.variant}`)}
                            className="text-[#666666] hover:text-[#FF4D4D] transition-colors p-1"
                            title="Remove item"
                            aria-label={`Remove ${item.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Selected Variant Badge */}
                        {item.variant && (
                          <div className="mt-0.5">
                            <span className="inline-block text-[10px] font-semibold text-[#7CFF00] bg-[#7CFF00]/10 px-2 py-0.2 rounded border border-[#7CFF00]/25">
                              {item.variant}
                            </span>
                          </div>
                        )}

                        {/* Unit Price & Quantity Row */}
                        <div className="mt-3 flex items-center justify-between">
                          {/* Stepper Quantity Selector */}
                          <div className="flex items-center space-x-1.5 bg-[#161616] border border-[#2A2A2A] rounded-lg p-0.5">
                            <button
                              id={`btn-qty-minus-${item.variantId || item.id}`}
                              onClick={() => onUpdateQuantity(item.variantId || `${item.id}_${item.variant}`, -1)}
                              className="w-6 h-6 rounded flex items-center justify-center text-[#AAAAAA] hover:text-[#FFFFFF] hover:bg-[#222222] transition-colors disabled:opacity-40"
                              title="Decrease quantity"
                              aria-label="Decrease quantity"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="w-6 text-center text-xs font-bold font-mono text-[#FFFFFF]">
                              {item.quantity}
                            </span>
                            <button
                              id={`btn-qty-plus-${item.variantId || item.id}`}
                              onClick={() => onUpdateQuantity(item.variantId || `${item.id}_${item.variant}`, 1)}
                              className="w-6 h-6 rounded flex items-center justify-center text-[#AAAAAA] hover:text-[#FFFFFF] hover:bg-[#222222] transition-colors"
                              title="Increase quantity"
                              aria-label="Increase quantity"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>

                          {/* Line Subtotal */}
                          <div className="text-right">
                            <span className="text-xs font-bold text-[#FFFFFF] font-mono">
                              ${(item.price * item.quantity).toFixed(2)}
                            </span>
                            {item.quantity > 1 && (
                              <span className="block text-[10px] text-[#666666]">
                                (${item.price.toFixed(2)} ea)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Sticky Cart Subtotal & Checkout Footer */}
              {cart.length > 0 && (
                <div className="p-6 bg-[#111111] border-t border-[#1E1E1E] space-y-3 shrink-0">
                  <div className="space-y-1.5 text-xs text-[#888888]">
                    <div className="flex justify-between">
                      <span>Items Subtotal ({totalItemCount})</span>
                      <span className="text-[#FFFFFF] font-mono font-semibold">${subtotal.toFixed(2)} USD</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Shipping (Express 2-3 Days)</span>
                      <span className="font-mono font-semibold text-[#7CFF00]">
                        {isFreeShipping ? 'FREE' : `$${shippingCost.toFixed(2)} USD`}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Estimated Sales Tax</span>
                      <span className="text-[#FFFFFF] font-mono">$0.00</span>
                    </div>
                    <div className="pt-2 border-t border-[#1C1C1C] flex justify-between text-sm font-bold text-[#FFFFFF]">
                      <span>Total</span>
                      <span className="font-mono text-base text-[#7CFF00]">${grandTotal.toFixed(2)} USD</span>
                    </div>
                  </div>

                  <div className="pt-2 space-y-2">
                    <button
                      id="btn-checkout"
                      onClick={() => setCheckoutStep('checkout')}
                      className="w-full py-3 px-4 rounded-xl bg-[#7CFF00] hover:bg-[#6BE000] text-[#090909] font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-neon-sm transition-all"
                    >
                      <span>Proceed to Demo Checkout</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>

                    <div className="flex items-center justify-between text-[11px] text-[#666666] pt-1 px-1">
                      <button
                        onClick={onClearCart}
                        className="hover:text-[#FF4D4D] transition-colors underline decoration-dotted"
                      >
                        Clear Bag
                      </button>
                      <button
                        onClick={onClose}
                        className="hover:text-[#FFFFFF] transition-colors"
                      >
                        Continue Shopping
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* =================================================================
              VIEW 2: DEMONSTRATION CHECKOUT FLOW
              ================================================================= */}
          {checkoutStep === 'checkout' && (
            <div className="flex-1 flex flex-col justify-between overflow-y-auto">
              <div className="p-6 space-y-5">
                {/* Demo Notice Banner */}
                <div className="p-3 rounded-xl bg-[#181818] border border-[#7CFF00]/30 space-y-1 text-xs">
                  <div className="flex items-center space-x-2 text-[#7CFF00] font-bold">
                    <Sparkles className="w-4 h-4" />
                    <span>Demonstration Checkout</span>
                  </div>
                  <p className="text-[11px] text-[#AAAAAA] leading-relaxed">
                    This is an interactive simulation. No real credit card or financial information will ever be requested or billed.
                  </p>
                </div>

                {/* Quick Auto-Fill Demo Button */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase text-[#777777] tracking-wider">Shipping Details</span>
                  <button
                    type="button"
                    onClick={handleAutoFillDemo}
                    className="text-[11px] font-semibold text-[#7CFF00] hover:underline flex items-center space-x-1"
                  >
                    <span>⚡ Auto-fill demo address</span>
                  </button>
                </div>

                {/* Shipping Details Form */}
                <form id="demo-checkout-form" onSubmit={handlePlaceOrder} className="space-y-3.5 text-xs">
                  <div>
                    <label className="block text-[11px] text-[#AAAAAA] mb-1">Full Name *</label>
                    <input
                      type="text"
                      value={shippingInfo.fullName}
                      onChange={(e) => setShippingInfo({ ...shippingInfo, fullName: e.target.value })}
                      placeholder="e.g. Alex Morgan"
                      className="w-full bg-[#141414] border border-[#262626] focus:border-[#7CFF00] rounded-xl px-3 py-2 text-xs text-[#FFFFFF] placeholder-[#555555] focus:outline-none transition-colors"
                    />
                    {formErrors.fullName && <span className="text-[10px] text-[#FF4D4D] mt-0.5 block">{formErrors.fullName}</span>}
                  </div>

                  <div>
                    <label className="block text-[11px] text-[#AAAAAA] mb-1">Email Address *</label>
                    <input
                      type="email"
                      value={shippingInfo.email}
                      onChange={(e) => setShippingInfo({ ...shippingInfo, email: e.target.value })}
                      placeholder="e.g. alex.morgan@example.com"
                      className="w-full bg-[#141414] border border-[#262626] focus:border-[#7CFF00] rounded-xl px-3 py-2 text-xs text-[#FFFFFF] placeholder-[#555555] focus:outline-none transition-colors"
                    />
                    {formErrors.email && <span className="text-[10px] text-[#FF4D4D] mt-0.5 block">{formErrors.email}</span>}
                  </div>

                  <div>
                    <label className="block text-[11px] text-[#AAAAAA] mb-1">Street Address *</label>
                    <input
                      type="text"
                      value={shippingInfo.address}
                      onChange={(e) => setShippingInfo({ ...shippingInfo, address: e.target.value })}
                      placeholder="e.g. 742 Evergreen Terrace, Suite 100"
                      className="w-full bg-[#141414] border border-[#262626] focus:border-[#7CFF00] rounded-xl px-3 py-2 text-xs text-[#FFFFFF] placeholder-[#555555] focus:outline-none transition-colors"
                    />
                    {formErrors.address && <span className="text-[10px] text-[#FF4D4D] mt-0.5 block">{formErrors.address}</span>}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-[#AAAAAA] mb-1">City *</label>
                      <input
                        type="text"
                        value={shippingInfo.city}
                        onChange={(e) => setShippingInfo({ ...shippingInfo, city: e.target.value })}
                        placeholder="e.g. Seattle"
                        className="w-full bg-[#141414] border border-[#262626] focus:border-[#7CFF00] rounded-xl px-3 py-2 text-xs text-[#FFFFFF] placeholder-[#555555] focus:outline-none transition-colors"
                      />
                      {formErrors.city && <span className="text-[10px] text-[#FF4D4D] mt-0.5 block">{formErrors.city}</span>}
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#AAAAAA] mb-1">Postal Code</label>
                      <input
                        type="text"
                        value={shippingInfo.postalCode}
                        onChange={(e) => setShippingInfo({ ...shippingInfo, postalCode: e.target.value })}
                        placeholder="e.g. 98101"
                        className="w-full bg-[#141414] border border-[#262626] focus:border-[#7CFF00] rounded-xl px-3 py-2 text-xs text-[#FFFFFF] placeholder-[#555555] focus:outline-none transition-colors"
                      />
                    </div>
                  </div>

                  {/* Delivery Method Summary */}
                  <div className="pt-2">
                    <span className="block text-[11px] text-[#AAAAAA] mb-1.5">Shipping Method</span>
                    <div className="p-3 rounded-xl bg-[#141414] border border-[#2A2A2A] flex items-center justify-between">
                      <div className="flex items-center space-x-2.5">
                        <Truck className="w-4 h-4 text-[#7CFF00]" />
                        <div>
                          <p className="font-semibold text-xs text-[#FFFFFF]">NovaCart Express Delivery</p>
                          <p className="text-[10px] text-[#888888]">2–3 business days • FedEx Tracking</p>
                        </div>
                      </div>
                      <span className="font-mono text-xs font-bold text-[#7CFF00]">{isFreeShipping ? 'FREE' : `$${shippingCost.toFixed(2)}`}</span>
                    </div>
                  </div>
                </form>

                {/* Items Summary in Checkout */}
                <div className="pt-3 border-t border-[#1C1C1C] space-y-2">
                  <span className="text-[11px] uppercase tracking-wider text-[#777777] font-bold">Order Summary ({totalItemCount} items)</span>
                  <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                    {cart.map((item) => (
                      <div key={item.variantId || item.id} className="flex items-center justify-between text-xs py-1">
                        <span className="truncate max-w-[240px] text-[#CCCCCC]">
                          {item.quantity}× {item.name} {item.variant ? `(${item.variant})` : ''}
                        </span>
                        <span className="font-mono text-[#FFFFFF] font-medium shrink-0">
                          ${(item.price * item.quantity).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Checkout Submission Footer */}
              <div className="p-6 bg-[#111111] border-t border-[#1E1E1E] space-y-2.5 shrink-0">
                <div className="flex justify-between items-center text-sm font-bold text-[#FFFFFF] pb-1">
                  <span>Grand Total</span>
                  <span className="font-mono text-base text-[#7CFF00]">${grandTotal.toFixed(2)} USD</span>
                </div>

                <button
                  id="btn-place-order"
                  type="submit"
                  form="demo-checkout-form"
                  className="w-full py-3 px-4 rounded-xl bg-[#7CFF00] hover:bg-[#6BE000] text-[#090909] font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-neon-sm transition-all"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Place Demo Order (${grandTotal.toFixed(2)} USD)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCheckoutStep('cart')}
                  className="w-full py-2 text-center text-xs text-[#888888] hover:text-[#FFFFFF] transition-colors"
                >
                  ← Return to Shopping Bag
                </button>
              </div>
            </div>
          )}

          {/* =================================================================
              VIEW 3: ORDER CONFIRMATION SCREEN
              ================================================================= */}
          {checkoutStep === 'confirmation' && confirmedOrder && (
            <div className="flex-1 flex flex-col justify-between overflow-y-auto p-6 space-y-6 animate-fadeIn">
              <div className="space-y-5 text-center pt-4">
                <div className="w-14 h-14 rounded-full bg-[#7CFF00]/15 border border-[#7CFF00]/40 flex items-center justify-center mx-auto text-[#7CFF00] shadow-neon-sm">
                  <CheckCircle2 className="w-8 h-8" />
                </div>

                <div className="space-y-1">
                  <h3 className="font-black text-lg text-[#FFFFFF]">Order Confirmed!</h3>
                  <p className="text-xs text-[#AAAAAA]">
                    Thank you, <span className="text-[#FFFFFF] font-semibold">{confirmedOrder.shippingInfo.fullName}</span>. Your demo purchase has been simulated.
                  </p>
                </div>

                {/* Generated Order Identifier Card */}
                <div className="p-4 rounded-xl bg-[#141414] border border-[#222222] text-left space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-[#222222]">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-[#666666]">Demo Order Number</span>
                      <p className="font-mono text-sm font-extrabold text-[#7CFF00]">{confirmedOrder.orderId}</p>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#10B981]/15 text-[#10B981] font-bold border border-[#10B981]/30">
                      Confirmed
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="block text-[10px] text-[#666666] uppercase font-bold">Courier & Tracking</span>
                      <span className="text-[#FFFFFF] font-mono text-[11px] truncate block mt-0.5">
                        {confirmedOrder.carrier}
                      </span>
                      <span className="text-[10px] text-[#7CFF00] font-mono">{confirmedOrder.trackingNumber}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-[#666666] uppercase font-bold">Estimated Delivery</span>
                      <span className="text-[#FFFFFF] text-[11px] block mt-0.5">{confirmedOrder.estimatedDelivery}</span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[#222222] text-[11px] text-[#AAAAAA]">
                    <span className="text-[#666666] block text-[10px] uppercase font-bold">Shipping Address:</span>
                    <span className="text-[#DDDDDD]">{confirmedOrder.shippingInfo.address}, {confirmedOrder.shippingInfo.city} {confirmedOrder.shippingInfo.postalCode}</span>
                  </div>
                </div>

                {/* Items Ordered Receipt */}
                <div className="text-left space-y-2">
                  <span className="text-[10px] uppercase tracking-wider text-[#777777] font-bold">Purchased Items ({confirmedOrder.itemCount})</span>
                  <div className="bg-[#121212] rounded-xl border border-[#202020] p-3 space-y-2 max-h-40 overflow-y-auto">
                    {confirmedOrder.items.map((it) => (
                      <div key={it.variantId || it.id} className="flex items-center justify-between text-xs">
                        <div className="flex items-center space-x-2 truncate">
                          <img src={it.image} alt={it.name} className="w-7 h-7 rounded object-cover" />
                          <span className="text-[#DDDDDD] truncate max-w-[200px]">
                            {it.quantity}× {it.name} {it.variant ? `(${it.variant})` : ''}
                          </span>
                        </div>
                        <span className="font-mono text-[#FFFFFF] font-semibold">${(it.price * it.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                    <div className="pt-2 border-t border-[#222222] flex justify-between text-xs font-bold text-[#FFFFFF]">
                      <span>Total Paid</span>
                      <span className="font-mono text-[#7CFF00]">${confirmedOrder.grandTotal.toFixed(2)} USD</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2.5 pt-4 border-t border-[#1E1E1E]">
                {onOpenSupportForOrder && (
                  <button
                    id="btn-track-resolve"
                    onClick={() => {
                      onOpenSupportForOrder(confirmedOrder.orderId);
                      handleFinishConfirmation();
                    }}
                    className="w-full py-2.5 px-4 rounded-xl bg-[#1A1A1A] hover:bg-[#242424] text-[#7CFF00] border border-[#7CFF00]/40 font-bold text-xs flex items-center justify-center space-x-2 transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Track with Resolve AI Assistant</span>
                  </button>
                )}

                <button
                  id="btn-confirm-continue"
                  onClick={handleFinishConfirmation}
                  className="w-full py-3 px-4 rounded-xl bg-[#7CFF00] hover:bg-[#6BE000] text-[#090909] font-black text-xs uppercase tracking-wider transition-all shadow-neon-sm"
                >
                  Continue Shopping
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

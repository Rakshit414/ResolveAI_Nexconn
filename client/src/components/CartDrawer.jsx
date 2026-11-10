import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { 
  ShoppingBag, 
  X, 
  Trash2, 
  Plus, 
  Minus, 
  ArrowRight, 
  ShieldCheck, 
  Truck, 
  RotateCcw, 
  CheckCircle2, 
  Sparkles,
  MessageSquare,
  AlertCircle
} from 'lucide-react';
import { useCart } from '../context/CartContext';

export default function CartDrawer({ onOpenSupportForOrder }) {
  const {
    cart,
    itemCount,
    cartSubtotalCents,
    cartSubtotalFormatted,
    isCartOpen,
    closeCart,
    updateQuantity,
    removeItem,
    clearCart
  } = useCart();

  const [checkoutStep, setCheckoutStep] = useState('cart'); // 'cart' | 'checkout' | 'confirmation'
  const [shippingInfo, setShippingInfo] = useState({
    fullName: 'Alex Morgan',
    email: 'alex.morgan@novacart.demo',
    address: '742 Evergreen Terrace, Suite 100',
    city: 'Seattle',
    postalCode: '98101',
    deliveryMethod: 'express'
  });
  const [formErrors, setFormErrors] = useState({});
  const [confirmedOrder, setConfirmedOrder] = useState(null);

  // Reset checkout step to cart when reopening unless reviewing a confirmed order
  useEffect(() => {
    if (isCartOpen && !confirmedOrder) {
      setCheckoutStep('cart');
    }
  }, [isCartOpen, confirmedOrder]);

  // Handle Escape key to close drawer
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isCartOpen) {
        closeCart();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCartOpen, closeCart]);

  // Lock background body scroll while drawer is open
  useEffect(() => {
    if (isCartOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isCartOpen]);

  if (!isCartOpen) return null;

  // Exact integer cents monetary calculation
  const freeShippingThresholdCents = 7500; // $75.00
  const isFreeShipping = cartSubtotalCents >= freeShippingThresholdCents;
  const shippingCents = cart.length === 0 ? 0 : (isFreeShipping ? 0 : 500); // $5.00 flat rate
  const grandTotalCents = cartSubtotalCents + shippingCents;

  const shippingFormatted = (shippingCents / 100).toFixed(2);
  const grandTotalFormatted = (grandTotalCents / 100).toFixed(2);

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
      itemCount,
      subtotalFormatted: cartSubtotalFormatted,
      shippingFormatted,
      grandTotalFormatted,
      shippingInfo: { ...shippingInfo },
      trackingNumber: `TRK-NC-${Math.floor(100000 + Math.random() * 900000)}`,
      carrier: 'FedEx Express Priority',
      estimatedDelivery: '3–4 Business Days'
    };

    setConfirmedOrder(placedOrder);
    setCheckoutStep('confirmation');
    clearCart(); // Safely empty cart state
  };

  // Return to shopping from confirmation
  const handleFinishConfirmation = () => {
    setConfirmedOrder(null);
    setCheckoutStep('cart');
    closeCart();
  };

  return ReactDOM.createPortal(
    <div 
      id="cart-drawer-root" 
      className="fixed inset-0 z-[100] overflow-hidden animate-fadeIn" 
      role="dialog" 
      aria-modal="true" 
      aria-labelledby="cart-heading"
    >
      {/* 1. Backdrop Overlay (Click to close) */}
      <div 
        id="cart-backdrop"
        onClick={closeCart}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity cursor-pointer"
      />

      {/* 2. Slide-over Container (Right on desktop, full-screen on mobile) */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-0 sm:pl-10 pointer-events-none">
        <div 
          id="cart-drawer" 
          className="pointer-events-auto w-screen sm:w-[480px] max-w-full bg-[#0D0D0D] border-l border-[#222222] shadow-2xl flex flex-col justify-between text-[#FFFFFF] animate-slideInRight"
        >
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
                <p id="cart-header-subtext" className="text-[11px] text-[#888888] font-mono">
                  {checkoutStep === 'cart' ? `${itemCount} ${itemCount === 1 ? 'item' : 'items'} in bag` : 'NovaCart Official Store'}
                </p>
              </div>
            </div>

            <button
              id="btn-close-cart"
              onClick={closeCart}
              className="p-1.5 rounded-lg text-[#888888] hover:text-[#FFFFFF] bg-[#181818] hover:bg-[#222222] border border-[#282828] transition-colors"
              title="Close bag (Esc)"
              aria-label="Close shopping bag"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* =================================================================
              VIEW 1: CART CONTENTS (Default)
              ================================================================= */}
          {checkoutStep === 'cart' && (
            <>
              {/* Free Shipping Meter */}
              {cart.length > 0 && (
                <div className="bg-[#141414] px-6 py-2.5 border-b border-[#1E1E1E] text-xs">
                  <div className="flex items-center justify-between text-[11px] mb-1.5">
                    {isFreeShipping ? (
                      <span className="text-[#7CFF00] font-semibold flex items-center space-x-1">
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>You unlocked FREE Express Shipping!</span>
                      </span>
                    ) : (
                      <span className="text-[#AAAAAA]">
                        Add <strong className="text-[#FFFFFF] font-mono">${((freeShippingThresholdCents - cartSubtotalCents) / 100).toFixed(2)}</strong> more for FREE Shipping
                      </span>
                    )}
                    <span className="font-mono text-[#7CFF00] font-bold">
                      {Math.min(100, Math.round((cartSubtotalCents / freeShippingThresholdCents) * 100))}%
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-[#222222] rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-[#7CFF00] rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, (cartSubtotalCents / freeShippingThresholdCents) * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Items List (Scrollable Area) */}
              <div id="cart-items-container" className="flex-1 overflow-y-auto px-6 py-4 divide-y divide-[#1A1A1A]">
                {cart.length === 0 ? (
                  /* Empty State */
                  <div id="cart-empty-state" className="h-full flex flex-col items-center justify-center py-16 text-center space-y-4">
                    <div className="w-16 h-16 rounded-2xl bg-[#141414] border border-[#222222] flex items-center justify-center text-[#555555]">
                      <ShoppingBag className="w-8 h-8 stroke-1 text-[#666666]" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-bold text-sm text-[#FFFFFF]">Your bag is empty</h3>
                      <p className="text-xs text-[#777777] max-w-xs">
                        Explore our performance apparel, wireless charging gear, and noise-cancelling audio.
                      </p>
                    </div>
                    <button
                      id="btn-continue-shopping"
                      onClick={closeCart}
                      className="px-5 py-2.5 rounded-xl bg-[#181818] hover:bg-[#222222] text-[#FFFFFF] text-xs font-semibold border border-[#2A2A2A] hover:border-[#7CFF00]/50 transition-colors"
                    >
                      Continue Shopping
                    </button>
                  </div>
                ) : (
                  /* Active Cart Items */
                  cart.map((item) => {
                    const lineSubtotalCents = item.unitPriceCents * item.quantity;
                    const lineSubtotalFormatted = (lineSubtotalCents / 100).toFixed(2);
                    const unitPriceFormatted = (item.unitPriceCents / 100).toFixed(2);
                    const sanitizedVariant = (item.variant || 'Standard').replace(/[^a-zA-Z0-9]/g, '_');
                    const itemKey = `${item.productId}_${sanitizedVariant}`;

                    return (
                      <div 
                        key={itemKey} 
                        id={`cart-item-${item.productId}`}
                        data-product-id={item.productId}
                        data-item-key={itemKey}
                        className="py-4 first:pt-0 last:pb-0 flex items-start space-x-3.5"
                      >
                        {/* Product Thumbnail */}
                        <img
                          src={item.image}
                          alt={item.name}
                          className="w-16 h-16 rounded-xl object-cover bg-[#090909] border border-[#222222] shrink-0"
                        />

                        {/* Product Metadata & Actions */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <h4 
                              id={`cart-item-title-${item.productId}`} 
                              className="font-bold text-xs text-[#FFFFFF] truncate leading-snug" 
                              title={item.name}
                            >
                              {item.name}
                            </h4>
                            <button
                              id={`btn-remove-${item.productId}`}
                              data-product-id={item.productId}
                              onClick={() => removeItem(item.productId, item.variant)}
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
                              <span 
                                id={`cart-item-variant-${item.productId}`}
                                className="inline-block text-[10px] font-semibold text-[#7CFF00] bg-[#7CFF00]/10 px-2 py-0.2 rounded border border-[#7CFF00]/25"
                              >
                                {item.variant}
                              </span>
                            </div>
                          )}

                          {/* Unit Price & Quantity Row */}
                          <div className="mt-3 flex items-center justify-between">
                            {/* Stepper Quantity Selector */}
                            <div className="flex items-center space-x-1.5 bg-[#161616] border border-[#2A2A2A] rounded-lg p-0.5">
                              <button
                                id={`btn-qty-minus-${item.productId}`}
                                data-product-id={item.productId}
                                onClick={() => updateQuantity(item.productId, item.variant, -1)}
                                className="w-6 h-6 rounded flex items-center justify-center text-[#AAAAAA] hover:text-[#FFFFFF] hover:bg-[#222222] transition-colors"
                                title="Decrease quantity"
                                aria-label="Decrease quantity"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <span 
                                id={`cart-item-qty-${item.productId}`}
                                className="w-6 text-center text-xs font-bold font-mono text-[#FFFFFF]"
                              >
                                {item.quantity}
                              </span>
                              <button
                                id={`btn-qty-plus-${item.productId}`}
                                data-product-id={item.productId}
                                onClick={() => updateQuantity(item.productId, item.variant, 1)}
                                className="w-6 h-6 rounded flex items-center justify-center text-[#AAAAAA] hover:text-[#FFFFFF] hover:bg-[#222222] transition-colors"
                                title="Increase quantity"
                                aria-label="Increase quantity"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* Line Subtotal */}
                            <div className="text-right">
                              <span 
                                id={`cart-item-subtotal-${item.productId}`}
                                className="text-xs font-bold text-[#FFFFFF] font-mono"
                              >
                                ${lineSubtotalFormatted}
                              </span>
                              {item.quantity > 1 && (
                                <span 
                                  id={`cart-item-price-${item.productId}`}
                                  className="block text-[10px] text-[#666666]"
                                >
                                  (${unitPriceFormatted} ea)
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Sticky Cart Subtotal & Checkout Footer */}
              {cart.length > 0 && (
                <div className="p-6 bg-[#111111] border-t border-[#1E1E1E] space-y-3 shrink-0">
                  <div className="space-y-1.5 text-xs text-[#888888]">
                    <div className="flex justify-between">
                      <span>Items Subtotal ({itemCount})</span>
                      <span id="cart-subtotal" className="text-[#FFFFFF] font-mono font-semibold">
                        ${cartSubtotalFormatted} USD
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Shipping (Express 2-3 Days)</span>
                      <span id="cart-shipping" className="font-mono font-semibold text-[#7CFF00]">
                        {isFreeShipping ? 'FREE' : `$${shippingFormatted} USD`}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Estimated Sales Tax</span>
                      <span className="text-[#FFFFFF] font-mono">$0.00</span>
                    </div>
                    <div className="pt-2 border-t border-[#1C1C1C] flex justify-between text-sm font-bold text-[#FFFFFF]">
                      <span>Total</span>
                      <span id="cart-grand-total" className="font-mono text-base text-[#7CFF00]">
                        ${grandTotalFormatted} USD
                      </span>
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
                        id="btn-clear-cart"
                        onClick={clearCart}
                        className="hover:text-[#FF4D4D] transition-colors underline decoration-dotted"
                      >
                        Clear Bag
                      </button>
                      <button
                        onClick={closeCart}
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
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Demo Mode Notice */}
              <div className="p-3.5 rounded-xl bg-[#161616] border border-[#262626] flex items-start space-x-2.5">
                <ShieldCheck className="w-4 h-4 text-[#7CFF00] shrink-0 mt-0.5" />
                <div className="text-xs space-y-0.5">
                  <p className="font-bold text-[#FFFFFF]">Simulated Checkout</p>
                  <p className="text-[#888888] text-[11px] leading-relaxed">
                    This is a demonstration store. No real payment or credit card is processed.
                  </p>
                </div>
              </div>

              {/* Quick Auto-Fill */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#CCCCCC]">Shipping Information</span>
                <button
                  type="button"
                  id="btn-auto-fill-demo"
                  onClick={handleAutoFillDemo}
                  className="text-[11px] text-[#7CFF00] hover:underline font-semibold flex items-center space-x-1"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Auto-fill Demo Details</span>
                </button>
              </div>

              {/* Shipping Form */}
              <form onSubmit={handlePlaceOrder} className="space-y-3.5">
                <div>
                  <label className="block text-[11px] text-[#888888] mb-1">Full Name</label>
                  <input
                    type="text"
                    id="input-full-name"
                    value={shippingInfo.fullName}
                    onChange={(e) => setShippingInfo({ ...shippingInfo, fullName: e.target.value })}
                    className="w-full bg-[#141414] border border-[#262626] rounded-xl px-3.5 py-2 text-xs text-[#FFFFFF] focus:border-[#7CFF00] focus:outline-none"
                    placeholder="Jane Doe"
                  />
                  {formErrors.fullName && <p className="text-[10px] text-[#FF4D4D] mt-1">{formErrors.fullName}</p>}
                </div>

                <div>
                  <label className="block text-[11px] text-[#888888] mb-1">Email Address</label>
                  <input
                    type="email"
                    id="input-email"
                    value={shippingInfo.email}
                    onChange={(e) => setShippingInfo({ ...shippingInfo, email: e.target.value })}
                    className="w-full bg-[#141414] border border-[#262626] rounded-xl px-3.5 py-2 text-xs text-[#FFFFFF] focus:border-[#7CFF00] focus:outline-none"
                    placeholder="jane@example.com"
                  />
                  {formErrors.email && <p className="text-[10px] text-[#FF4D4D] mt-1">{formErrors.email}</p>}
                </div>

                <div>
                  <label className="block text-[11px] text-[#888888] mb-1">Shipping Address</label>
                  <input
                    type="text"
                    id="input-address"
                    value={shippingInfo.address}
                    onChange={(e) => setShippingInfo({ ...shippingInfo, address: e.target.value })}
                    className="w-full bg-[#141414] border border-[#262626] rounded-xl px-3.5 py-2 text-xs text-[#FFFFFF] focus:border-[#7CFF00] focus:outline-none"
                    placeholder="123 Market St, Suite 400"
                  />
                  {formErrors.address && <p className="text-[10px] text-[#FF4D4D] mt-1">{formErrors.address}</p>}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-[#888888] mb-1">City</label>
                    <input
                      type="text"
                      id="input-city"
                      value={shippingInfo.city}
                      onChange={(e) => setShippingInfo({ ...shippingInfo, city: e.target.value })}
                      className="w-full bg-[#141414] border border-[#262626] rounded-xl px-3.5 py-2 text-xs text-[#FFFFFF] focus:border-[#7CFF00] focus:outline-none"
                      placeholder="Seattle"
                    />
                    {formErrors.city && <p className="text-[10px] text-[#FF4D4D] mt-1">{formErrors.city}</p>}
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#888888] mb-1">Postal Code</label>
                    <input
                      type="text"
                      id="input-postal-code"
                      value={shippingInfo.postalCode}
                      onChange={(e) => setShippingInfo({ ...shippingInfo, postalCode: e.target.value })}
                      className="w-full bg-[#141414] border border-[#262626] rounded-xl px-3.5 py-2 text-xs text-[#FFFFFF] focus:border-[#7CFF00] focus:outline-none"
                      placeholder="98101"
                    />
                  </div>
                </div>

                {/* Delivery Option */}
                <div className="pt-2">
                  <label className="block text-[11px] text-[#888888] mb-1.5">Delivery Method</label>
                  <div className="p-3 rounded-xl bg-[#141414] border border-[#7CFF00]/40 flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2.5">
                      <Truck className="w-4 h-4 text-[#7CFF00]" />
                      <div>
                        <span className="font-bold text-[#FFFFFF]">FedEx Priority Express</span>
                        <span className="block text-[10px] text-[#777777]">Estimated 2–3 Business Days</span>
                      </div>
                    </div>
                    <span className="font-mono font-bold text-[#7CFF00]">
                      {isFreeShipping ? 'FREE' : `$${shippingFormatted}`}
                    </span>
                  </div>
                </div>

                {/* Order Summary Recap */}
                <div className="p-3.5 rounded-xl bg-[#111111] border border-[#1E1E1E] space-y-1.5 text-xs">
                  <div className="flex justify-between text-[#888888]">
                    <span>Items Total ({itemCount})</span>
                    <span className="font-mono text-[#FFFFFF]">${cartSubtotalFormatted}</span>
                  </div>
                  <div className="flex justify-between text-[#888888]">
                    <span>Shipping</span>
                    <span className="font-mono text-[#7CFF00]">
                      {isFreeShipping ? 'FREE' : `$${shippingFormatted}`}
                    </span>
                  </div>
                  <div className="pt-1.5 border-t border-[#1C1C1C] flex justify-between font-bold text-[#FFFFFF]">
                    <span>Grand Total</span>
                    <span className="font-mono text-sm text-[#7CFF00]">${grandTotalFormatted} USD</span>
                  </div>
                </div>

                {/* Submit Actions */}
                <div className="pt-2 space-y-2">
                  <button
                    type="submit"
                    id="btn-place-order"
                    className="w-full py-3 px-4 rounded-xl bg-[#7CFF00] hover:bg-[#6BE000] text-[#090909] font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-neon-sm transition-all"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Complete Demo Order</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCheckoutStep('cart')}
                    className="w-full py-2 text-center text-xs text-[#888888] hover:text-[#FFFFFF] transition-colors"
                  >
                    ← Return to Shopping Bag
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* =================================================================
              VIEW 3: ORDER CONFIRMED
              ================================================================= */}
          {checkoutStep === 'confirmation' && confirmedOrder && (
            <div className="flex-1 overflow-y-auto p-6 space-y-5 flex flex-col justify-between">
              <div className="space-y-4">
                {/* Success Banner */}
                <div className="text-center py-4 space-y-2">
                  <div className="w-12 h-12 rounded-full bg-[#7CFF00]/15 border border-[#7CFF00]/40 flex items-center justify-center text-[#7CFF00] mx-auto">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h3 className="font-black text-base text-[#FFFFFF]">Order Confirmed!</h3>
                  <p className="text-xs text-[#888888]">
                    Thank you, <strong className="text-[#FFFFFF]">{confirmedOrder.shippingInfo.fullName}</strong>. Your demonstration order has been created.
                  </p>
                </div>

                {/* Receipt Card */}
                <div className="p-4 rounded-xl bg-[#141414] border border-[#242424] space-y-3 text-xs">
                  <div className="flex items-center justify-between pb-2.5 border-b border-[#1E1E1E]">
                    <div>
                      <span className="text-[10px] text-[#666666] uppercase block font-mono">Order Number</span>
                      <span id="confirmed-order-id" className="font-mono font-bold text-sm text-[#7CFF00]">
                        {confirmedOrder.orderId}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-[#666666] uppercase block font-mono">Carrier</span>
                      <span className="text-xs font-semibold text-[#FFFFFF]">{confirmedOrder.carrier}</span>
                    </div>
                  </div>

                  <div className="space-y-1 text-[#AAAAAA] text-[11px]">
                    <div className="flex justify-between">
                      <span>Delivery Target:</span>
                      <span className="text-[#FFFFFF] font-medium">{confirmedOrder.estimatedDelivery}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Tracking Code:</span>
                      <span className="font-mono text-[#7CFF00]">{confirmedOrder.trackingNumber}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Items Count:</span>
                      <span className="font-mono text-[#FFFFFF]">{confirmedOrder.itemCount} items</span>
                    </div>
                    <div className="flex justify-between font-bold text-xs pt-2 border-t border-[#1C1C1C] text-[#FFFFFF]">
                      <span>Amount Paid:</span>
                      <span className="font-mono text-[#7CFF00]">${confirmedOrder.grandTotalFormatted} USD</span>
                    </div>
                  </div>
                </div>

                {/* Real-time Support Widget Integration Hook */}
                <div className="p-4 rounded-xl bg-gradient-to-br from-[#121A10] to-[#121212] border border-[#7CFF00]/30 space-y-2.5">
                  <div className="flex items-center space-x-2 text-[#7CFF00]">
                    <MessageSquare className="w-4 h-4" />
                    <span className="font-bold text-xs">Resolve AI Support Integration</span>
                  </div>
                  <p className="text-[11px] text-[#888888] leading-relaxed">
                    Have questions about delivery times or order details? Chat instantly with our AI copilot or escalate to human specialists.
                  </p>
                  <button
                    id="btn-track-in-support"
                    onClick={() => {
                      if (onOpenSupportForOrder) {
                        onOpenSupportForOrder(confirmedOrder.orderId);
                      }
                      closeCart();
                    }}
                    className="w-full py-2.5 px-3 rounded-lg bg-[#7CFF00] hover:bg-[#6BE000] text-[#090909] font-black text-xs flex items-center justify-center space-x-1.5 shadow-neon-sm transition-all"
                  >
                    <span>Track with Resolve AI Assistant</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Done / Continue Shopping */}
              <div className="pt-4 border-t border-[#1C1C1C]">
                <button
                  id="btn-confirmation-continue"
                  onClick={handleFinishConfirmation}
                  className="w-full py-3 px-4 rounded-xl bg-[#1A1A1A] hover:bg-[#222222] text-[#FFFFFF] font-semibold text-xs border border-[#2E2E2E] transition-colors"
                >
                  Continue Shopping
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

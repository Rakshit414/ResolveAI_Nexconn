import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';

const CART_STORAGE_KEY = 'novacart_storefront_cart';

export function loadCartFromStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return [];
    }
    const saved = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!saved) return [];

    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];

    const validItems = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;

      const productId = item.productId || item.id;
      if (!productId || typeof productId !== 'string') continue;

      const name = item.name || 'NovaCart Item';
      const image = item.image || '';
      const variant = item.variant || 'Standard';

      // Determine unitPriceCents safely (handle integer cents, float price, or strings)
      let unitPriceCents = 0;
      if (typeof item.unitPriceCents === 'number' && Number.isInteger(item.unitPriceCents) && item.unitPriceCents > 0) {
        unitPriceCents = item.unitPriceCents;
      } else if (typeof item.price === 'number' && item.price > 0) {
        unitPriceCents = Math.round(item.price * 100);
      } else if (typeof item.price === 'string' && !isNaN(parseFloat(item.price))) {
        unitPriceCents = Math.round(parseFloat(item.price) * 100);
      }

      const quantity = typeof item.quantity === 'number' && item.quantity > 0 
        ? Math.floor(item.quantity) 
        : 1;

      if (unitPriceCents > 0) {
        validItems.push({
          productId,
          name,
          image,
          variant,
          unitPriceCents,
          quantity
        });
      }
    }
    return validItems;
  } catch (err) {
    console.warn('[CartContext] Error loading cart from storage:', err);
    return [];
  }
}

export function saveCartToStorage(cartItems) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cartItems));
    }
  } catch (err) {
    console.warn('[CartContext] Error saving cart to storage:', err);
  }
}

const CartContext = createContext(null);

export function CartProvider({ children }) {
  // Single source of truth for all cart state
  const [cart, setCart] = useState(() => loadCartFromStorage());
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Sync to localStorage on every cart mutation
  useEffect(() => {
    saveCartToStorage(cart);
  }, [cart]);

  // Derived metrics calculated strictly with integer cents
  const { itemCount, cartSubtotalCents } = useMemo(() => {
    let count = 0;
    let totalCents = 0;
    for (const item of cart) {
      count += item.quantity;
      totalCents += item.unitPriceCents * item.quantity;
    }
    return {
      itemCount: count,
      cartSubtotalCents: totalCents
    };
  }, [cart]);

  // Add product to cart and immediately open drawer
  const addToCart = useCallback((product, chosenVariant) => {
    const productId = product.id || product.productId;
    const variant = chosenVariant || product.variants?.[0] || 'Standard';
    const unitPriceCents = product.unitPriceCents || Math.round((product.price || 0) * 100);

    setCart(prevCart => {
      const existingIndex = prevCart.findIndex(
        item => item.productId === productId && item.variant === variant
      );

      if (existingIndex > -1) {
        const next = [...prevCart];
        next[existingIndex] = {
          ...next[existingIndex],
          quantity: next[existingIndex].quantity + 1
        };
        return next;
      } else {
        return [
          ...prevCart,
          {
            productId,
            name: product.name,
            image: product.image,
            variant,
            unitPriceCents,
            quantity: 1
          }
        ];
      }
    });

    // Automatically open the cart drawer so the customer sees the result
    setIsCartOpen(true);
  }, []);

  // Update item quantity by delta (+1 / -1)
  const updateQuantity = useCallback((productId, variant, delta) => {
    setCart(prevCart => {
      return prevCart
        .map(item => {
          if (item.productId === productId && item.variant === variant) {
            const nextQty = item.quantity + delta;
            return nextQty > 0 ? { ...item, quantity: nextQty } : null;
          }
          return item;
        })
        .filter(Boolean);
    });
  }, []);

  // Remove a specific line item
  const removeItem = useCallback((productId, variant) => {
    setCart(prevCart => 
      prevCart.filter(item => !(item.productId === productId && item.variant === variant))
    );
  }, []);

  // Clear all cart items
  const clearCart = useCallback(() => {
    setCart([]);
  }, []);

  const openCart = useCallback(() => setIsCartOpen(true), []);
  const closeCart = useCallback(() => setIsCartOpen(false), []);
  const toggleCart = useCallback(() => setIsCartOpen(prev => !prev), []);

  const value = useMemo(() => ({
    cart,
    itemCount,
    cartSubtotalCents,
    cartSubtotalFormatted: (cartSubtotalCents / 100).toFixed(2),
    isCartOpen,
    openCart,
    closeCart,
    toggleCart,
    addToCart,
    updateQuantity,
    removeItem,
    clearCart
  }), [
    cart,
    itemCount,
    cartSubtotalCents,
    isCartOpen,
    openCart,
    closeCart,
    toggleCart,
    addToCart,
    updateQuantity,
    removeItem,
    clearCart
  ]);

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}

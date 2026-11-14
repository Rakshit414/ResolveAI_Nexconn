export const TAX_RATE = 0.08; // 8% sales tax on merchandise
export const FREE_SHIPPING_THRESHOLD_CENTS = 7500; // $75.00
export const FLAT_SHIPPING_CENTS = 500; // $5.00

/**
 * Pure calculation function enforcing integer-cents arithmetic throughout the storefront.
 */
export function calculateCartTotals(
  cartItems,
  taxRate = TAX_RATE,
  freeShippingThresholdCents = FREE_SHIPPING_THRESHOLD_CENTS,
  flatShippingCents = FLAT_SHIPPING_CENTS
) {
  let itemCount = 0;
  let cartSubtotalCents = 0;
  if (Array.isArray(cartItems)) {
    for (const item of cartItems) {
      const qty = Math.max(0, Math.floor(item.quantity || 0));
      const priceCents = Math.max(0, Math.round(item.unitPriceCents || (item.price ? item.price * 100 : 0)));
      itemCount += qty;
      cartSubtotalCents += priceCents * qty;
    }
  }

  const isFreeShipping = cartSubtotalCents >= freeShippingThresholdCents;
  const shippingCents = (!cartItems || cartItems.length === 0 || cartSubtotalCents === 0)
    ? 0
    : (isFreeShipping ? 0 : flatShippingCents);
  const taxCents = (!cartItems || cartItems.length === 0 || cartSubtotalCents === 0)
    ? 0
    : Math.round(cartSubtotalCents * taxRate);
  const grandTotalCents = cartSubtotalCents + shippingCents + taxCents;

  return {
    itemCount,
    cartSubtotalCents,
    cartSubtotalFormatted: (cartSubtotalCents / 100).toFixed(2),
    shippingCents,
    shippingFormatted: (shippingCents / 100).toFixed(2),
    isFreeShipping,
    taxCents,
    taxFormatted: (taxCents / 100).toFixed(2),
    grandTotalCents,
    grandTotalFormatted: (grandTotalCents / 100).toFixed(2)
  };
}

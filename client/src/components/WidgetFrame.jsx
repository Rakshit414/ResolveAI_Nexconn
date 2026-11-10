import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import EmbeddableWidget from './EmbeddableWidget';
import { DEMO_CUSTOMERS } from '../data/demoData';

export default function WidgetFrame() {
  const [searchParams] = useSearchParams();
  const brandId = searchParams.get('brand') || 'brand_novacart';
  const themeColor = searchParams.get('theme') || '#7CFF00';
  const customerId = searchParams.get('customer') || searchParams.get('id') || 'cust_aarav';
  const orderId = searchParams.get('order');

  // Match initial customer
  let matchedCustomer = DEMO_CUSTOMERS.find(c => c.id === customerId);
  if (!matchedCustomer && orderId) {
    matchedCustomer = DEMO_CUSTOMERS.find(c => c.order?.orderId === orderId);
  }
  const [currentCustomer, setCurrentCustomer] = useState(matchedCustomer || DEMO_CUSTOMERS[0]);
  const [isOpen, setIsOpen] = useState(false);

  // Notify parent window to resize iframe
  const handleToggle = () => {
    const nextState = !isOpen;
    setIsOpen(nextState);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'RESOLVE_AI_WIDGET_RESIZE',
        isOpen: nextState
      }, '*');
    }
  };

  // Listen to external API postMessages with strict security validation
  useEffect(() => {
    const handleMessage = (event) => {
      // 1. Validate event.source: MUST originate strictly from the embedding parent window
      if (window.parent && window.parent !== window && event.source !== window.parent) {
        console.warn('[Resolve AI Security] Rejected message: event.source does not match parent window');
        return;
      }

      // 2. Validate event.origin: normalize and verify against exact allowed origin Set
      let normalizedOrigin = null;
      try {
        if (event.origin && event.origin !== 'null') {
          const parsed = new URL(event.origin);
          if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            normalizedOrigin = parsed.origin.toLowerCase();
          }
        }
      } catch (e) {
        normalizedOrigin = null;
      }

      const isProd = import.meta.env.PROD;
      const allowedOrigins = new Set();

      // Current host origin
      if (window.location.origin) {
        allowedOrigins.add(window.location.origin.toLowerCase());
      }
      allowedOrigins.add('https://resolve-ai-novacart.onrender.com');

      if (!isProd) {
        allowedOrigins.add('http://localhost:5173');
        allowedOrigins.add('http://127.0.0.1:5173');
        allowedOrigins.add('http://localhost:5000');
        allowedOrigins.add('http://127.0.0.1:5000');
      }

      if (!normalizedOrigin || !allowedOrigins.has(normalizedOrigin)) {
        console.warn('[Resolve AI Security] Rejected postMessage from untrusted origin:', event.origin);
        return;
      }

      // 3. Process authorized widget actions
      if (event.data?.type === 'RESOLVE_AI_ACTION') {
        if (event.data.action === 'open') {
          setIsOpen(true);
          window.parent?.postMessage({ type: 'RESOLVE_AI_WIDGET_RESIZE', isOpen: true }, '*');
        } else if (event.data.action === 'close') {
          setIsOpen(false);
          window.parent?.postMessage({ type: 'RESOLVE_AI_WIDGET_RESIZE', isOpen: false }, '*');
        } else if (event.data.action === 'setCustomer' && event.data.customerId) {
          const found = DEMO_CUSTOMERS.find(c => c.id === event.data.customerId);
          if (found) setCurrentCustomer(found);
        } else if (event.data.action === 'setOrder' && event.data.orderId) {
          const found = DEMO_CUSTOMERS.find(c => c.order?.orderId === event.data.orderId);
          if (found) setCurrentCustomer(found);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className="w-full h-full bg-transparent flex flex-col items-end justify-end overflow-hidden">
      <EmbeddableWidget
        brandId={brandId}
        customer={currentCustomer}
        onSelectCustomer={setCurrentCustomer}
        themeOverride={{ primaryColor: themeColor }}
        isOpen={isOpen}
        onToggle={handleToggle}
        isStandalone={false}
      />
    </div>
  );
}

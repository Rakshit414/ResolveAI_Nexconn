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

  // Listen to external API postMessages
  useEffect(() => {
    const handleMessage = (event) => {
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

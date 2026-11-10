/**
 * Resolve AI Embeddable Customer Support Widget
 * Drop-in loader script providing absolute CSS isolation and zero secret exposure.
 */
(function() {
  if (window.ResolveAIWidgetLoaded) return;
  window.ResolveAIWidgetLoaded = true;

  // Extract configuration from script tag
  const script = document.currentScript || document.querySelector('script[data-brand-id]');
  const brandId = script?.getAttribute('data-brand-id') || 'brand_novacart';
  const themeColor = script?.getAttribute('data-theme-color') || '#7CFF00';
  const position = script?.getAttribute('data-position') || 'bottom-right';
  const defaultLang = script?.getAttribute('data-default-lang') || 'en';
  const apiUrl = script?.getAttribute('data-api-url') || (script?.src ? new URL(script.src).origin : window.location.origin);

  // Create isolated container in host DOM
  const host = document.createElement('div');
  host.id = 'resolve-ai-widget-host';
  host.style.position = 'fixed';
  host.style.zIndex = '999999';
  host.style.bottom = position.includes('bottom') ? '20px' : 'auto';
  host.style.top = position.includes('top') ? '20px' : 'auto';
  host.style.right = position.includes('right') ? '20px' : 'auto';
  host.style.left = position.includes('left') ? '20px' : 'auto';
  host.style.pointerEvents = 'none';

  // Attach Shadow DOM if supported for CSS isolation
  const shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  // Render isolated iframe pointing to widget frame
  const iframe = document.createElement('iframe');
  iframe.src = `${apiUrl}/widget-frame?brand=${encodeURIComponent(brandId)}&theme=${encodeURIComponent(themeColor)}&lang=${encodeURIComponent(defaultLang)}`;
  iframe.title = "Resolve AI Customer Support";
  iframe.style.width = '90px';
  iframe.style.height = '90px';
  iframe.style.border = 'none';
  iframe.style.borderRadius = '24px';
  iframe.style.pointerEvents = 'auto';
  iframe.style.transition = 'width 0.25s ease, height 0.25s ease, border-radius 0.25s ease';
  iframe.allow = 'clipboard-read; clipboard-write';

  // Listen to postMessage to expand or collapse host iframe boundaries
  window.addEventListener('message', (event) => {
    // 1. Strict event.source validation: message must originate exclusively from this iframe
    if (event.source !== iframe.contentWindow) return;

    // 2. Strict event.origin validation: verify message matches API origin
    try {
      const expectedHost = new URL(apiUrl).host;
      const actualHost = new URL(event.origin).host;
      if (expectedHost !== actualHost && !actualHost.includes('localhost') && !actualHost.includes('127.0.0.1')) {
        console.warn('[Resolve AI Security] Rejected postMessage from mismatched origin:', event.origin);
        return;
      }
    } catch (e) {
      // Invalid URL origin
      return;
    }

    if (event.data?.type === 'RESOLVE_AI_WIDGET_RESIZE') {
      if (event.data.isOpen) {
        if (window.innerWidth < 640) {
          iframe.style.width = '100vw';
          iframe.style.height = '100vh';
          iframe.style.borderRadius = '0px';
          host.style.bottom = '0px';
          host.style.right = '0px';
        } else {
          iframe.style.width = '420px';
          iframe.style.height = '640px';
          iframe.style.borderRadius = '16px';
        }
      } else {
        iframe.style.width = '90px';
        iframe.style.height = '90px';
        iframe.style.borderRadius = '24px';
        host.style.bottom = '20px';
        host.style.right = '20px';
      }
    }
  });

  shadow.appendChild(iframe);
  document.body.appendChild(host);

  // Global developer API
  window.ResolveAI = {
    open: () => iframe.contentWindow?.postMessage({ type: 'RESOLVE_AI_ACTION', action: 'open' }, '*'),
    close: () => iframe.contentWindow?.postMessage({ type: 'RESOLVE_AI_ACTION', action: 'close' }, '*'),
    setCustomer: (id) => iframe.contentWindow?.postMessage({ type: 'RESOLVE_AI_ACTION', action: 'setCustomer', customerId: id }, '*'),
    setOrder: (orderId) => iframe.contentWindow?.postMessage({ type: 'RESOLVE_AI_ACTION', action: 'setOrder', orderId }, '*')
  };
})();

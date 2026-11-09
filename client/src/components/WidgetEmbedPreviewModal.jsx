import React, { useState } from 'react';
import { 
  X, 
  Copy, 
  Check, 
  Code, 
  Sparkles, 
  ShieldCheck, 
  Palette, 
  Sliders, 
  Terminal, 
  Lock, 
  CheckCircle2,
  ExternalLink
} from 'lucide-react';

export default function WidgetEmbedPreviewModal({ isOpen, onClose }) {
  const [copied, setCopied] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState('brand_novacart');
  const [themeColor, setThemeColor] = useState('#7CFF00');
  const [position, setPosition] = useState('bottom-right');
  const [language, setLanguage] = useState('en');

  if (!isOpen) return null;

  // Preset themes
  const PRESET_BRANDS = [
    { id: 'brand_novacart', name: 'NovaCart Marketplace', color: '#7CFF00' },
    { id: 'brand_lumina', name: 'Lumina Timepieces', color: '#6366F1' },
    { id: 'brand_apex', name: 'Apex Athletics', color: '#FF5722' },
  ];

  const handleSelectPreset = (brand) => {
    setSelectedBrand(brand.id);
    setThemeColor(brand.color);
  };

  const embedSnippet = `<!-- Resolve AI Embeddable Customer Support Widget -->
<script 
  src="${window.location.origin}/widget.js" 
  data-brand-id="${selectedBrand}"
  data-theme-color="${themeColor}"
  data-position="${position}"
  data-default-lang="${language}"
  defer>
</script>`;

  const handleCopy = () => {
    navigator.clipboard.writeText(embedSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-2xl bg-[#0F0F0F] border border-[#222222] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1E1E1E] flex items-center justify-between bg-[#141414]">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#7CFF00] flex items-center justify-center text-[#090909]">
              <Code className="w-4 h-4 font-bold" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#FFFFFF]">Resolve AI Widget Integration</h3>
              <p className="text-[11px] text-[#888888]">Embed real-time multi-brand support into any e-commerce storefront</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#202020] text-[#888888] hover:text-[#FFFFFF] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          
          {/* Brand Customization Controls */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-[#CCCCCC] flex items-center space-x-1.5">
              <Palette className="w-3.5 h-3.5 text-[#7CFF00]" />
              <span>Brand Theming & Configuration</span>
            </label>

            {/* Presets */}
            <div className="grid grid-cols-3 gap-2">
              {PRESET_BRANDS.map(brand => (
                <button
                  key={brand.id}
                  onClick={() => handleSelectPreset(brand)}
                  className={`p-2 rounded-xl border text-xs font-medium flex items-center space-x-2 transition-all ${
                    selectedBrand === brand.id 
                      ? 'bg-[#181818] border-[#7CFF00] text-[#FFFFFF]' 
                      : 'bg-[#121212] border-[#222222] text-[#888888] hover:text-[#FFFFFF]'
                  }`}
                >
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: brand.color }}></span>
                  <span className="truncate">{brand.name}</span>
                </button>
              ))}
            </div>

            {/* Settings Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <div>
                <span className="text-[11px] text-[#888888] block mb-1">Primary Color</span>
                <div className="flex items-center space-x-2 bg-[#161616] border border-[#262626] rounded-lg px-2 py-1">
                  <input 
                    type="color" 
                    value={themeColor} 
                    onChange={(e) => setThemeColor(e.target.value)}
                    className="w-5 h-5 bg-transparent border-0 cursor-pointer"
                  />
                  <span className="text-xs font-mono text-[#CCCCCC]">{themeColor}</span>
                </div>
              </div>

              <div>
                <span className="text-[11px] text-[#888888] block mb-1">Launcher Position</span>
                <select
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  className="w-full bg-[#161616] text-xs text-[#CCCCCC] border border-[#262626] rounded-lg px-2 py-1.5 focus:border-[#7CFF00] focus:outline-none"
                >
                  <option value="bottom-right">Bottom Right</option>
                  <option value="bottom-left">Bottom Left</option>
                </select>
              </div>

              <div>
                <span className="text-[11px] text-[#888888] block mb-1">Default Language</span>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full bg-[#161616] text-xs text-[#CCCCCC] border border-[#262626] rounded-lg px-2 py-1.5 focus:border-[#7CFF00] focus:outline-none"
                >
                  <option value="en">English</option>
                  <option value="hi">Hindi (हिंदी)</option>
                  <option value="mr">Marathi (मराठी)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Copy-Paste Embed Snippet */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[#CCCCCC] flex items-center space-x-1.5">
                <Terminal className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>HTML Embed Snippet</span>
              </span>
              <button
                onClick={handleCopy}
                className="flex items-center space-x-1 text-xs text-[#7CFF00] hover:underline font-semibold"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied to Clipboard!' : 'Copy Code'}</span>
              </button>
            </div>

            <div className="relative rounded-xl bg-[#090909] border border-[#1E1E1E] p-3.5 font-mono text-xs text-[#E0E0E0] overflow-x-auto leading-relaxed">
              <pre>{embedSnippet}</pre>
            </div>
            <p className="text-[11px] text-[#666666]">
              Paste before the closing <code className="text-[#888888]">&lt;/body&gt;</code> tag on any HTML, Shopify, WooCommerce, or Next.js storefront.
            </p>
          </div>

          {/* Security & Architectural Guarantees */}
          <div className="bg-[#121212] border border-[#1E1E1E] rounded-xl p-4 space-y-2.5 text-xs">
            <div className="flex items-center space-x-1.5 text-[#10B981] font-semibold">
              <ShieldCheck className="w-4 h-4" />
              <span>Enterprise Isolation & Zero Secret Exposure</span>
            </div>
            <ul className="space-y-1.5 text-[11px] text-[#888888]">
              <li className="flex items-center space-x-2">
                <CheckCircle2 className="w-3 h-3 text-[#7CFF00] shrink-0" />
                <span><strong>No Leaked Credentials:</strong> Nexconn App Secret, Gemini API keys, and database credentials remain strictly server-side.</span>
              </li>
              <li className="flex items-center space-x-2">
                <CheckCircle2 className="w-3 h-3 text-[#7CFF00] shrink-0" />
                <span><strong>Shadow DOM / Iframe Isolation:</strong> Widget styles and scripts cannot bleed into or break host storefront CSS.</span>
              </li>
              <li className="flex items-center space-x-2">
                <CheckCircle2 className="w-3 h-3 text-[#7CFF00] shrink-0" />
                <span><strong>PostgreSQL Origin Whitelist:</strong> Host domains are verified against brand allowed origins via <code className="text-[#AAAAAA]">POST /api/widget/bootstrap</code>.</span>
              </li>
            </ul>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#1E1E1E] bg-[#141414] flex items-center justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#222222] hover:bg-[#2A2A2A] text-xs font-semibold text-[#FFFFFF] transition-colors"
          >
            Done
          </button>
        </div>

      </div>
    </div>
  );
}

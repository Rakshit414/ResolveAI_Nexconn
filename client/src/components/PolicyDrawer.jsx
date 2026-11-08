import React from 'react';
import { X, BookOpen } from 'lucide-react';
import { BUSINESS_INFO } from '../data/demoData';

export default function PolicyDrawer({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/75 backdrop-blur-sm flex justify-end">
      <div 
        className="w-full max-w-md bg-[#0E0E0E] border-l border-[#222222] h-full overflow-y-auto flex flex-col p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#222222]">
          <div className="flex items-center space-x-2">
            <BookOpen className="w-4 h-4 text-[#7CFF00]" />
            <span className="font-bold text-xs text-[#FFFFFF]">NovaCart Business Policies</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#8A8A8A] hover:text-[#FFFFFF] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* AI Guardrail Callout */}
        <div className="mt-3.5 p-3 rounded bg-[#161616] border border-[#222222] text-xs">
          <strong className="text-[#7CFF00] font-bold block">AI Copilot Guardrail</strong>
          <p className="mt-0.5 text-[#8A8A8A] leading-relaxed text-[11px]">
            The AI assistant will not promise unverified refunds, financial compensation, or unconfirmed delivery dates without supporting verification.
          </p>
        </div>

        {/* Policies List */}
        <div className="mt-4 space-y-2.5 flex-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#8A8A8A] block">
            Retail Operations Rules
          </span>

          {BUSINESS_INFO.policies.map((p, idx) => (
            <div
              key={p.id}
              className="p-3 rounded bg-[#161616] border border-[#222222] hover:border-[#7CFF00]/30 text-xs space-y-1 transition-colors"
            >
              <div className="flex items-center space-x-2">
                <span className="text-[10px] text-[#7CFF00] font-mono font-bold">0{idx + 1}.</span>
                <span className="font-semibold text-[#FFFFFF]">{p.topic}</span>
              </div>
              <p className="text-[#8A8A8A] text-[11px] leading-relaxed pl-5">{p.rule}</p>
              <div className="pl-5 pt-1 text-[10px] text-[#555555]">
                Guideline: {p.actionGuideline}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-[#222222] text-[10px] text-[#555555] flex items-center justify-between">
          <span>NovaCart Operations</span>
          <span>support@novacart.demo</span>
        </div>
      </div>
    </div>
  );
}

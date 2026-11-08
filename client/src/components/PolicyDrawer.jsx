import React from 'react';
import { X, BookOpen, Check } from 'lucide-react';
import { BUSINESS_INFO } from '../data/demoData';

export default function PolicyDrawer({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm flex justify-end">
      <div 
        className="w-full max-w-md bg-[#111311] border-l border-[#353B35] h-full overflow-y-auto flex flex-col p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#353B35]">
          <div className="flex items-center space-x-2">
            <BookOpen className="w-4 h-4 text-[#174B35]" />
            <span className="font-semibold text-xs text-[#D5D9D3]">NovaCart Business Policies</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#929A91] hover:text-[#D5D9D3] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* AI Guardrail Callout */}
        <div className="mt-3.5 p-3 rounded bg-[#242724] border border-[#353B35] text-xs">
          <strong className="text-[#D5D9D3] font-semibold block">AI Copilot Guardrail</strong>
          <p className="mt-0.5 text-[#929A91] leading-relaxed text-[11px]">
            The AI assistant will not promise unverified refunds, financial compensation, or unconfirmed delivery dates without supporting verification.
          </p>
        </div>

        {/* Policies List */}
        <div className="mt-4 space-y-2.5 flex-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#929A91] block">
            Retail Operations Rules
          </span>

          {BUSINESS_INFO.policies.map((p, idx) => (
            <div
              key={p.id}
              className="p-3 rounded bg-[#191A19] border border-[#353B35] text-xs space-y-1"
            >
              <div className="flex items-center space-x-2">
                <span className="text-[10px] text-[#929A91] font-mono">0{idx + 1}.</span>
                <span className="font-medium text-[#D5D9D3]">{p.topic}</span>
              </div>
              <p className="text-[#929A91] text-[11px] leading-relaxed pl-5">{p.rule}</p>
              <div className="pl-5 pt-1 text-[10px] text-[#687267]">
                Guideline: {p.actionGuideline}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-[#353B35] text-[10px] text-[#687267] flex items-center justify-between">
          <span>NovaCart Operations</span>
          <span>support@novacart.demo</span>
        </div>
      </div>
    </div>
  );
}

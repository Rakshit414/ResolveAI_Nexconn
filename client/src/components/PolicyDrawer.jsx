import React from 'react';
import { X, ShieldAlert, CheckCircle2, BookOpen, AlertTriangle } from 'lucide-react';
import { BUSINESS_INFO } from '../data/demoData';

export default function PolicyDrawer({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm flex justify-end animate-fadeIn">
      <div 
        className="w-full max-w-md bg-[#0D1527] border-l border-slate-850 h-full overflow-y-auto flex flex-col shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-indigo/20 flex items-center justify-center text-brand-indigo">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">NovaCart Knowledge Base</h2>
              <p className="text-xs text-slate-400">Business Rules & AI Guardrails</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* AI Guardrail Warning Alert */}
        <div className="mt-4 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200">
          <div className="flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <strong className="font-semibold text-amber-300">Mandatory AI Guardrail:</strong>
              <p className="mt-0.5 text-slate-300">
                Resolve AI never automatically promises refunds, financial compensation, or unconfirmed delivery dates without verified supporting information.
              </p>
            </div>
          </div>
        </div>

        {/* Policies List */}
        <div className="mt-5 space-y-3.5 flex-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Active Retail Policies
          </h3>

          {BUSINESS_INFO.policies.map((p, idx) => (
            <div
              key={p.id}
              className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-center space-x-2 mb-1.5">
                <span className="w-5 h-5 rounded-full bg-brand-indigo/20 text-brand-indigo text-[11px] font-bold flex items-center justify-center">
                  {idx + 1}
                </span>
                <span className="text-xs font-semibold text-white">{p.topic}</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed pl-7">{p.rule}</p>
              <div className="mt-2 pl-7 pt-2 border-t border-slate-800/80 flex items-start space-x-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <span className="text-[11px] text-slate-400">
                  <strong className="text-slate-300">Agent Action:</strong> {p.actionGuideline}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Footer info */}
        <div className="mt-6 pt-4 border-t border-slate-800 text-[11px] text-slate-400">
          <p>Support Hotline: <span className="text-slate-200">{BUSINESS_INFO.supportPhone}</span></p>
          <p>Email: <span className="text-slate-200">{BUSINESS_INFO.supportEmail}</span></p>
          <p className="mt-1 text-slate-500">Demo Retail Environment for Nexconn Build Challenge</p>
        </div>
      </div>
    </div>
  );
}

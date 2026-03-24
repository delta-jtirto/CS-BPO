// ╔══════════════════════════════════════════════════════════════╗
// ║  AI DEBUG PANEL                                               ║
// ║  Floating drawer that shows exactly what gets sent to the AI  ║
// ║  Enable via:  debug: true  in /config/ai-settings.ts          ║
// ╚══════════════════════════════════════════════════════════════╝

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AI_SETTINGS } from '../../../../../../config/ai-settings';
import type { AIDebugPayload } from '../../../../../../lib/ai-service';
import { copyToClipboard as clipCopy } from '../../../../../../lib/clipboard';
import { Bug, X, ChevronDown, ChevronUp, Copy, Check, Trash2, Clock, Zap, FileText, MessageSquare } from 'lucide-react';

// ── Entry in the log ──
interface DebugEntry extends AIDebugPayload {
  id: number;
}

let entryCounter = 0;

export const AIDebugPanel: React.FC = () => {
  const [entries, setEntries] = useState<DebugEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'system' | 'user' | 'vars'>('user');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const debugEnabled = AI_SETTINGS.debug;

  // Listen for ai-debug events from callAI
  useEffect(() => {
    if (!debugEnabled) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<AIDebugPayload>).detail;
      const entry: DebugEntry = { ...detail, id: ++entryCounter };
      setEntries(prev => [entry, ...prev].slice(0, 50)); // keep last 50
      setExpandedId(entry.id);
      setIsOpen(true);
      setActiveTab('user');
    };
    window.addEventListener('ai-debug', handler);
    return () => window.removeEventListener('ai-debug', handler);
  }, [debugEnabled]);

  // Only render anything if debug mode is on
  if (!debugEnabled) return null;

  const copyToClipboard = (text: string, field: string) => {
    clipCopy(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    }).catch(() => {
      console.warn('[AIDebugPanel] Copy to clipboard failed');
    });
  };

  const clearAll = () => {
    setEntries([]);
    setExpandedId(null);
  };

  const expanded = expandedId !== null ? entries.find(e => e.id === expandedId) : null;

  // Pill for the collapsed state
  if (!isOpen) {
    return createPortal(
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-3 right-3 z-[9999] flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-amber-400 rounded-full shadow-lg hover:bg-slate-800 transition-all"
        style={{ fontSize: '11px', fontWeight: 600, pointerEvents: 'auto' }}
      >
        <Bug size={13} />
        AI Debug
        {entries.length > 0 && (
          <span className="ml-0.5 bg-amber-500 text-slate-900 rounded-full px-1.5 py-0" style={{ fontSize: '10px', fontWeight: 700 }}>
            {entries.length}
          </span>
        )}
      </button>,
      document.body,
    );
  }

  return createPortal(
    <div
      ref={panelRef}
      className="fixed bottom-0 right-0 z-[9999] flex flex-col bg-slate-900 text-slate-200 shadow-2xl border-l border-t border-slate-700 rounded-tl-xl"
      style={{ width: '480px', maxHeight: '70vh', fontSize: '12px', pointerEvents: 'auto' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* ── Header bar ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-2">
          <Bug size={14} className="text-amber-400" />
          <span className="text-amber-400" style={{ fontWeight: 700, fontSize: '12px' }}>
            AI Debug
          </span>
          <span className="text-slate-500" style={{ fontSize: '10px' }}>
            {entries.length} call{entries.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {entries.length > 0 && (
            <button
              onClick={clearAll}
              className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800 transition-colors"
              title="Clear all"
            >
              <Trash2 size={12} />
            </button>
          )}
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
            title="Minimize"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ── Entry list (sidebar-style) ── */}
      {entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-10 text-slate-500">
          <div className="text-center">
            <Bug size={24} className="mx-auto mb-2 opacity-30" />
            <p style={{ fontSize: '12px' }}>Waiting for AI calls...</p>
            <p className="text-slate-600 mt-1" style={{ fontSize: '10px' }}>
              Click any AI generate button
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {/* Call list — compact */}
          <div className="shrink-0 border-b border-slate-700 overflow-x-auto no-scrollbar">
            <div className="flex gap-0.5 px-2 py-1.5">
              {entries.map(entry => (
                <button
                  key={entry.id}
                  onClick={() => {
                    setExpandedId(expandedId === entry.id ? null : entry.id);
                    setActiveTab('user');
                  }}
                  className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${
                    expandedId === entry.id
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-slate-800 text-slate-400 border border-transparent hover:bg-slate-750 hover:text-slate-300'
                  }`}
                  style={{ fontSize: '10px', fontWeight: 500 }}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${entry.isMock ? 'bg-orange-400' : 'bg-green-400'}`} />
                  <span className="truncate max-w-[120px]">{entry.promptKey}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Expanded detail */}
          {expanded ? (
            <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar">
              {/* Meta row */}
              <div className="px-3 py-2 border-b border-slate-800 bg-slate-850">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-slate-300" style={{ fontSize: '10px' }}>
                    <Zap size={9} className="text-amber-400" />
                    {expanded.model}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-slate-300" style={{ fontSize: '10px' }}>
                    temp: {expanded.temperature}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-slate-300" style={{ fontSize: '10px' }}>
                    max: {expanded.maxTokens}
                  </span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-slate-300 ${
                    expanded.responseFormat === 'json' ? 'bg-indigo-900/50' : 'bg-slate-800'
                  }`} style={{ fontSize: '10px' }}>
                    {expanded.responseFormat}
                  </span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${
                    expanded.isMock ? 'bg-orange-900/40 text-orange-300' : 'bg-green-900/40 text-green-300'
                  }`} style={{ fontSize: '10px' }}>
                    {expanded.isMock ? 'MOCK' : 'LIVE'}
                  </span>
                  <span className="inline-flex items-center gap-1 text-slate-600 ml-auto" style={{ fontSize: '10px' }}>
                    <Clock size={9} />
                    {new Date(expanded.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-slate-800 px-3 pt-1">
                {(['user', 'system', 'vars'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-1.5 border-b-2 transition-colors ${
                      activeTab === tab
                        ? 'border-amber-400 text-amber-300'
                        : 'border-transparent text-slate-500 hover:text-slate-300'
                    }`}
                    style={{ fontSize: '11px', fontWeight: activeTab === tab ? 600 : 400 }}
                  >
                    {tab === 'user' && <><MessageSquare size={10} className="inline mr-1" />User Prompt</>}
                    {tab === 'system' && <><FileText size={10} className="inline mr-1" />System</>}
                    {tab === 'vars' && <><Zap size={10} className="inline mr-1" />Variables ({Object.keys(expanded.variables).length})</>}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="p-3">
                {activeTab === 'user' && (
                  <div className="relative">
                    <CopyButton
                      text={expanded.userMessage}
                      field="user"
                      copiedField={copiedField}
                      onCopy={copyToClipboard}
                    />
                    <pre className="whitespace-pre-wrap text-slate-300 bg-slate-800/60 rounded-lg p-3 border border-slate-700/50 max-h-[40vh] overflow-y-auto custom-scrollbar" style={{ fontSize: '11px', lineHeight: '1.6' }}>
                      {expanded.userMessage}
                    </pre>
                  </div>
                )}

                {activeTab === 'system' && (
                  <div className="relative">
                    <CopyButton
                      text={expanded.systemMessage}
                      field="system"
                      copiedField={copiedField}
                      onCopy={copyToClipboard}
                    />
                    <pre className="whitespace-pre-wrap text-slate-300 bg-slate-800/60 rounded-lg p-3 border border-slate-700/50 max-h-[40vh] overflow-y-auto custom-scrollbar" style={{ fontSize: '11px', lineHeight: '1.6' }}>
                      {expanded.systemMessage}
                    </pre>
                  </div>
                )}

                {activeTab === 'vars' && (
                  <div className="space-y-1">
                    <CopyButton
                      text={JSON.stringify(expanded.variables, null, 2)}
                      field="vars"
                      copiedField={copiedField}
                      onCopy={copyToClipboard}
                    />
                    {Object.entries(expanded.variables).map(([key, val]) => {
                      const isEmpty = !val || val.trim() === '';
                      const isLong = val.length > 100;
                      return (
                        <div key={key} className="flex gap-2 py-1.5 border-b border-slate-800/50 last:border-0">
                          <code className="shrink-0 text-amber-400/80 select-all" style={{ fontSize: '11px', fontWeight: 500 }}>
                            {`{{${key}}}`}
                          </code>
                          <span className="text-slate-500 shrink-0">=</span>
                          {isEmpty ? (
                            <span className="text-slate-600 italic" style={{ fontSize: '11px' }}>(empty)</span>
                          ) : (
                            <span className={`text-slate-300 break-all ${isLong ? 'line-clamp-3' : ''}`} style={{ fontSize: '11px' }} title={val}>
                              {val}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center py-8 text-slate-600" style={{ fontSize: '11px' }}>
              Select a call above to inspect
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
};


// ── Tiny copy button ──
const CopyButton: React.FC<{
  text: string;
  field: string;
  copiedField: string | null;
  onCopy: (text: string, field: string) => void;
}> = ({ text, field, copiedField, onCopy }) => (
  <button
    onClick={() => onCopy(text, field)}
    className="absolute top-1 right-1 z-10 p-1.5 rounded bg-slate-700/80 hover:bg-slate-600 text-slate-400 hover:text-slate-200 transition-colors"
    title="Copy to clipboard"
  >
    {copiedField === field ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
  </button>
);
import { useState, useEffect, useRef, useSyncExternalStore, Component, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Bug, X, Trash2, Copy, Check, Clock, Zap,
  AlertTriangle, CheckCircle, MessageSquare, FileText, ArrowRight, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getDebugEntries,
  clearDebugEntries,
  subscribeDebug,
  type AIDebugEntry,
} from '../../ai/debug-store';

/**
 * Error boundary wrapper — if the debug panel crashes for any reason,
 * it silently disappears instead of taking down the parent view.
 */
class DebugPanelBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: Error) { console.warn('[AIDebugPanel] Caught error, hiding panel:', err.message); }
  render() { return this.state.hasError ? null : this.props.children; }
}

/**
 * Floating AI Debug Panel — bottom-right pill that expands into a
 * dark inspector showing every LLM request/response.
 *
 * Render once (e.g. in InboxView or AppLayout) — it self-manages
 * its open/collapsed state. Wrapped in an error boundary so it
 * can never crash the parent tree.
 */
export function AIDebugPanel() {
  return (
    <DebugPanelBoundary>
      <AIDebugPanelInner />
    </DebugPanelBoundary>
  );
}

function AIDebugPanelInner() {
  const entries = useSyncExternalStore(subscribeDebug, getDebugEntries, getDebugEntries);

  const [isOpen, setIsOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'user' | 'system' | 'response' | 'attachment'>('user');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const lastSeenIdRef = useRef<string | null>(null);

  // Auto-expand newest entry when a new call arrives
  useEffect(() => {
    const latest = entries[0];
    if (latest && latest.id !== lastSeenIdRef.current) {
      lastSeenIdRef.current = latest.id;
      setExpandedId(latest.id);
      // Auto-switch to Response tab for compose-reply so the loading state is visible
      // Auto-switch to Attachment tab for document imports
      if (latest.touchpoint === 'compose-reply') setActiveTab('response');
      else if (latest.touchpoint === 'kb-document-import') setActiveTab('attachment');
      else setActiveTab('user');
      setIsOpen(true);
    }
  }, [entries]);

  const copyToClipboard = (text: string, field: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 1500);
      }).catch(() => fallbackCopy(text, field));
    } else {
      fallbackCopy(text, field);
    }
  };

  const fallbackCopy = (text: string, field: string) => {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (success) {
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 1500);
      } else {
        toast.error('Copy failed');
      }
    } catch {
      toast.error('Clipboard access not available');
    }
  };

  const expanded = expandedId ? entries.find(e => e.id === expandedId) : null;

  // ─── Collapsed pill ─────────────────────────────────────
  if (!isOpen) {
    return createPortal(
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-3 right-3 z-[9999] flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-amber-400 rounded-full shadow-lg hover:bg-slate-800 transition-all"
        style={{ fontSize: '11px', fontWeight: 600 }}
      >
        <Bug size={13} />
        AI Debug
        {entries.length > 0 && (
          <span
            className="ml-0.5 bg-amber-500 text-slate-900 rounded-full px-1.5"
            style={{ fontSize: '10px', fontWeight: 700 }}
          >
            {entries.length}
          </span>
        )}
      </button>,
      document.body,
    );
  }

  // ─── Expanded panel ─────────────────────────────────────
  return createPortal(
    <div
      className="fixed bottom-0 right-0 z-[9999] flex flex-col bg-slate-900 text-slate-200 shadow-2xl border-l border-t border-slate-700 rounded-tl-xl"
      style={{ width: '480px', maxHeight: '70vh', fontSize: '12px' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* ── Header ── */}
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
              onClick={() => { clearDebugEntries(); setExpandedId(null); toast.info('Debug log cleared'); }}
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

      {entries.length === 0 ? (
        /* ── Empty state ── */
        <div className="flex-1 flex items-center justify-center py-10 text-slate-500">
          <div className="text-center">
            <Bug size={24} className="mx-auto mb-2 opacity-30" />
            <p style={{ fontSize: '12px' }}>Waiting for AI calls...</p>
            <p className="text-slate-600 mt-1" style={{ fontSize: '10px' }}>
              Use Smart Reply, Compose, or Ask AI to see debug output
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {/* ── Call list (horizontal tabs) ── */}
          <div className="shrink-0 border-b border-slate-700 overflow-x-auto">
            <div className="flex gap-0.5 px-2 py-1.5" style={{ scrollbarWidth: 'none' }}>
              {entries.map(entry => (
                <button
                  key={entry.id}
                  onClick={() => {
                    setExpandedId(expandedId === entry.id ? null : entry.id);
                    setActiveTab(entry.touchpoint === 'kb-document-import' ? 'attachment' : 'user');
                  }}
                  className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${
                    expandedId === entry.id
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-slate-800 text-slate-400 border border-transparent hover:bg-slate-800/80 hover:text-slate-300'
                  }`}
                  style={{ fontSize: '10px', fontWeight: 500 }}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${entry.error ? 'bg-red-400' : 'bg-green-400'}`} />
                  <span className="truncate max-w-[100px]">{entry.touchpoint}</span>
                  {entry.durationMs !== null && (
                    <span className="text-slate-500">{entry.durationMs}ms</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* ── Expanded detail ── */}
          {expanded ? (
            <div className="flex-1 overflow-y-auto min-h-0">
              {/* Meta row */}
              <div className="px-3 py-2 border-b border-slate-800">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Status */}
                  {expanded.error ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-900/40 text-red-300" style={{ fontSize: '10px' }}>
                      <AlertTriangle size={9} /> Error
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-900/40 text-green-300" style={{ fontSize: '10px' }}>
                      <CheckCircle size={9} /> OK
                    </span>
                  )}
                  {/* Touchpoint */}
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-slate-300 ${
                    expanded.touchpoint === 'compose-reply' ? 'bg-indigo-900/50' : 'bg-purple-900/50'
                  }`} style={{ fontSize: '10px' }}>
                    {expanded.touchpoint}
                  </span>
                  {/* Model */}
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-slate-300" style={{ fontSize: '10px' }}>
                    <Zap size={9} className="text-amber-400" />
                    {expanded.model}
                  </span>
                  {/* HTTP Status */}
                  {expanded.status && (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${
                      expanded.status >= 400 ? 'bg-red-900/40 text-red-300' : 'bg-slate-800 text-slate-300'
                    }`} style={{ fontSize: '10px' }}>
                      HTTP {expanded.status}
                    </span>
                  )}
                  {/* Tokens */}
                  {expanded.tokensUsed && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-slate-300" style={{ fontSize: '10px' }}>
                      {expanded.tokensUsed.prompt}
                      <ArrowRight size={7} className="text-slate-500" />
                      {expanded.tokensUsed.completion}
                      <span className="text-slate-500 ml-0.5">= {expanded.tokensUsed.total} tok</span>
                    </span>
                  )}
                  {/* Duration */}
                  {expanded.durationMs !== null && (
                    <span className="inline-flex items-center gap-1 text-slate-500 ml-auto" style={{ fontSize: '10px' }}>
                      <Clock size={9} />
                      {expanded.durationMs}ms
                    </span>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-slate-800 px-3 pt-1">
                {(['user', 'system', 'response', 'attachment'] as const).map(tab => {
                  // Hide Attachment tab when there's no attachment data
                  if (tab === 'attachment' && !expanded.attachment) return null;
                  return (
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
                      {tab === 'response' && (
                        <>
                          {expanded.durationMs === null && !expanded.error
                            ? <Loader2 size={10} className="inline mr-1 animate-spin text-amber-400" />
                            : expanded.error
                              ? <AlertTriangle size={10} className="inline mr-1 text-red-400" />
                              : <CheckCircle size={10} className="inline mr-1" />
                          }
                          Response
                        </>
                      )}
                      {tab === 'attachment' && <><FileText size={10} className="inline mr-1 text-violet-400" />Attachment</>}
                    </button>
                  );
                })}
              </div>

              {/* Tab content */}
              <div className="p-3">
                {activeTab === 'user' && (
                  <PromptBlock
                    text={expanded.userPrompt}
                    field="user"
                    copiedField={copiedField}
                    onCopy={copyToClipboard}
                    color="cyan"
                  />
                )}
                {activeTab === 'system' && (
                  <PromptBlock
                    text={expanded.systemPrompt}
                    field="system"
                    copiedField={copiedField}
                    onCopy={copyToClipboard}
                    color="blue"
                  />
                )}
                {activeTab === 'response' && (
                  expanded.durationMs === null && !expanded.error ? (
                    <div className="flex items-center gap-2.5 py-6 px-1 text-slate-400">
                      <Loader2 size={15} className="animate-spin text-amber-400 shrink-0" />
                      <span style={{ fontSize: '11px' }}>Generating response…</span>
                    </div>
                  ) : (
                    <PromptBlock
                      text={expanded.response || '(no response)'}
                      field="response"
                      copiedField={copiedField}
                      onCopy={copyToClipboard}
                      color={expanded.error ? 'red' : 'green'}
                    />
                  )
                )}
                {activeTab === 'attachment' && (
                  expanded.attachment ? (
                    <PromptBlock
                      text={expanded.attachment}
                      field="attachment"
                      copiedField={copiedField}
                      onCopy={copyToClipboard}
                      color="blue"
                    />
                  ) : (
                    <div className="py-4 text-slate-500 text-center" style={{ fontSize: '11px' }}>
                      No attachment for this call
                    </div>
                  )
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
}

// ─── Prompt Block with copy button ─────────────────────
function PromptBlock({
  text,
  field,
  copiedField,
  onCopy,
  color,
}: {
  text: string;
  field: string;
  copiedField: string | null;
  onCopy: (text: string, field: string) => void;
  color: 'blue' | 'cyan' | 'green' | 'red';
}) {
  const borderMap = {
    blue: 'border-blue-700/40',
    cyan: 'border-cyan-700/40',
    green: 'border-emerald-700/40',
    red: 'border-red-700/40',
  };

  return (
    <div className={`relative border rounded-lg overflow-hidden ${borderMap[color]}`}>
      <button
        onClick={() => onCopy(text, field)}
        className="absolute top-1.5 right-1.5 z-10 p-1.5 rounded bg-slate-700/80 hover:bg-slate-600 text-slate-400 hover:text-slate-200 transition-colors"
        title="Copy to clipboard"
      >
        {copiedField === field ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
      </button>
      <pre
        className="whitespace-pre-wrap break-words text-slate-300 bg-slate-950/40 p-3 pr-10 max-h-[40vh] overflow-y-auto font-mono leading-relaxed"
        style={{ fontSize: '11px', lineHeight: '1.6' }}
      >
        {text}
      </pre>
    </div>
  );
}
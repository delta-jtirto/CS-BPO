import { AlertTriangle, HelpCircle, FileQuestion, CheckCircle2 } from 'lucide-react';
import type { KnowledgeChunk } from '../../../data/types';

/**
 * Inbox-zero queue for chunks with status='pending_review'.
 *
 * Renders the list in the middle column of the Inspector. The parent
 * (KnowledgeInspector) drives the auto-advance behavior — this component
 * only surfaces the queue + a "caught up" terminal state.
 */

interface Props {
  chunks: KnowledgeChunk[];
  selectedId: string | null;
  onSelect: (chunkId: string) => void;
  onExit: () => void;
  resolvedInSession: number;
}

export function TriageQueue({ chunks, selectedId, onSelect, onExit, resolvedInSession }: Props) {
  if (chunks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-50 flex items-center justify-center">
            <CheckCircle2 size={24} className="text-emerald-600" />
          </div>
          <h3 className="text-sm font-semibold text-slate-800 mb-1">All caught up</h3>
          <p className="text-xs text-slate-500 mb-4">
            {resolvedInSession > 0
              ? `${resolvedInSession} ${resolvedInSession === 1 ? 'entry' : 'entries'} resolved in this session.`
              : 'Nothing to review right now.'}
          </p>
          <button
            type="button"
            onClick={onExit}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800 underline underline-offset-2"
          >
            Back to all knowledge
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b bg-amber-50 flex items-center gap-2">
        <AlertTriangle size={14} className="text-amber-600 shrink-0" />
        <span className="text-xs font-semibold text-amber-900">
          {chunks.length} {chunks.length === 1 ? 'entry needs' : 'entries need'} review
        </span>
        <button
          type="button"
          onClick={onExit}
          className="ml-auto text-[10px] font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2"
        >
          Exit triage
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {chunks.map((c, i) => {
          const reason = deriveReason(c);
          const selected = c.id === selectedId;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                className={`w-full text-left px-3 py-2.5 transition-colors ${
                  selected ? 'bg-indigo-50 border-l-2 border-indigo-500 pl-[calc(0.75rem-2px)]' : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="shrink-0 mt-0.5">
                    {reason.icon === 'unmapped' ? (
                      <FileQuestion size={14} className="text-amber-600" />
                    ) : (
                      <HelpCircle size={14} className="text-amber-600" />
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-amber-800 font-medium mb-0.5">
                      {i + 1}. {reason.label}
                    </div>
                    <div className="text-sm text-slate-800 truncate font-medium">{c.title}</div>
                    <div className="text-[11px] text-slate-500 truncate mt-0.5">
                      {c.body.slice(0, 80)}{c.body.length > 80 ? '…' : ''}
                    </div>
                    {c.source.docSheet && (
                      <div className="text-[10px] text-slate-400 mt-1">
                        From {c.source.docSheet}
                        {c.source.docRow !== undefined ? ` · Row ${c.source.docRow}` : ''}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Infer the reason a chunk is pending — drives the queue row label. */
function deriveReason(c: KnowledgeChunk): { icon: 'unmapped' | 'low-confidence'; label: string } {
  if (c.kind === 'property_fact' && !c.slotKey) {
    return { icon: 'unmapped', label: "Couldn't match a field" };
  }
  return { icon: 'low-confidence', label: 'Low confidence — verify' };
}

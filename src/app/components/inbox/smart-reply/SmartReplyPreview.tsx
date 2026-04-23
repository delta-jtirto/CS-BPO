import React from 'react';
import { Check, Minus, Pencil, AlertTriangle, BookOpen } from 'lucide-react';
import { ScrollArea } from '@/app/components/ui/scroll-area';
import { SmartReplyHeader } from './SmartReplyHeader';
import type { SmartReplyState, SmartReplyPanelProps } from './types';

type Props = Pick<SmartReplyPanelProps, 'onHide' | 'onInsert' | 'cacheRef'> &
  Pick<SmartReplyState, 'composedMessage' | 'inquiries' | 'kbMatchesByInquiry' | 'decisions' | 'customTexts' | 'coveredCount' | 'uncoveredCount' | 'hasApiKey' | 'setPhase' | 'cacheKey'>;

export function SmartReplyPreview({
  onHide,
  onInsert,
  cacheRef,
  composedMessage,
  inquiries,
  kbMatchesByInquiry,
  decisions,
  customTexts,
  coveredCount,
  uncoveredCount,
  hasApiKey,
  setPhase,
  cacheKey,
}: Props) {
  return (
    <>
      <SmartReplyHeader
        onAction={onHide}
        actionLabel="Hide"
        subtitle={hasApiKey ? 'AI' : 'Template'}
      />

      {/* Composed message */}
      <div className="px-4 pb-2">
        <ScrollArea className="max-h-48">
          <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{composedMessage}</p>
        </ScrollArea>
      </div>

      {/* Citations — which KB entries fed this reply. Agents who need to
          verify a fact can follow the trail back to the source chunk. Keeps
          provenance visible without forcing a click when unnecessary. */}
      {(() => {
        const seen = new Set<string>();
        const sources: { title: string; source?: string }[] = [];
        for (const inq of inquiries) {
          const matches = kbMatchesByInquiry[inq.id] ?? [];
          for (const m of matches) {
            const title = m.entry.title;
            if (!title || seen.has(title)) continue;
            seen.add(title);
            // Back-compat label for provenance — maps the new ChunkSource
            // shape to the short human-readable tags the citation row
            // previously showed.
            const sourceLabel =
              m.entry.source.type === 'form' ? 'onboarding form' :
              m.entry.source.type === 'doc_ingest' ? (m.entry.source.docSheet ?? 'imported doc') :
              m.entry.source.type === 'portal' ? 'host portal' :
              undefined;
            sources.push({ title, source: sourceLabel });
          }
        }
        if (sources.length === 0) return null;
        return (
          <div className="px-4 pb-2">
            <div className="flex items-start gap-1.5 text-[10px] text-slate-500">
              <BookOpen size={10} className="mt-0.5 shrink-0 text-slate-400" />
              <span className="leading-relaxed">
                <span className="text-slate-400 mr-1">Drew from:</span>
                {sources.map((s, i) => (
                  <span key={s.title}>
                    <span className="text-slate-600">{s.title}</span>
                    {s.source && <span className="text-slate-400"> ({s.source})</span>}
                    {i < sources.length - 1 && <span className="text-slate-300"> · </span>}
                  </span>
                ))}
              </span>
            </div>
          </div>
        );
      })()}

      {/* Partial coverage warning */}
      {uncoveredCount > 0 && coveredCount > 0 && (
        <div className="px-4 pb-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertTriangle size={10} className="text-amber-500 shrink-0" />
            <span className="text-[10px] text-amber-700">
              {uncoveredCount} topic{uncoveredCount > 1 ? 's' : ''} not covered — review before sending
            </span>
          </div>
        </div>
      )}

      {/* Decision summary chips */}
      <div className="px-4 pb-2 flex flex-wrap gap-1 items-center">
        {inquiries.map(inq => {
          const custom = customTexts[inq.id]?.trim();
          const dec = decisions[inq.id];
          const shortLabel = inq.label.replace(/\s*(Request|Complaint|Issue|Inquiry)$/i, '');
          const hasKB = (kbMatchesByInquiry[inq.id] || []).length > 0;
          return (
            <span
              key={inq.id}
              className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-0.5 border ${
                !hasKB
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : custom
                  ? 'bg-blue-50 text-blue-600 border-blue-200'
                  : dec === 'yes'
                  ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                  : 'bg-red-50 text-red-500 border-red-200'
              }`}
            >
              {!hasKB ? <AlertTriangle size={7} /> : custom ? <Pencil size={7} /> : dec === 'yes' ? <Check size={7} /> : <Minus size={7} />}
              {shortLabel}
            </span>
          );
        })}
        <button
          onClick={() => setPhase('configure')}
          className="text-[9px] font-medium text-indigo-600 hover:text-indigo-800 ml-1 underline underline-offset-2 decoration-indigo-300 p-0 leading-[inherit]"
        >
          Edit
        </button>
      </div>

      {/* Actions */}
      <div className="px-4 py-2.5 flex items-center justify-end gap-2 border-t border-slate-100">
        <button
          onClick={() => {
            delete cacheRef.current[cacheKey];
            onInsert(composedMessage);
          }}
          className="px-4 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 shadow-sm transition-all active:scale-95 flex items-center gap-1.5"
        >
          <Pencil size={12} /> Insert to edit
        </button>
      </div>
    </>
  );
}

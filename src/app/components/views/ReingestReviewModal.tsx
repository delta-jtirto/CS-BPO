import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { Separator } from '../ui/separator';
import {
  Sparkles, RefreshCw, Archive, AlertTriangle, ChevronLeft, ChevronRight,
  FileText, ShieldCheck, Undo2, CheckCircle2,
} from 'lucide-react';
import type { KnowledgeChunk, IngestedDocument } from '../../data/types';
import type { DiffOutcome, PendingReviewItem } from '../../lib/reingest-diff';

/**
 * Re-ingest review UI. Two screens:
 *
 *   1. Summary — "X new, Y unchanged, Z archived, N need review". If no
 *      review items, user clicks Apply and we're done. Otherwise they go
 *      to the pager.
 *
 *   2. Pager — one review item at a time. User picks Keep / Replace / Skip
 *      per conflict. When all resolved, back to summary which now shows
 *      "N resolved" and the Apply button.
 *
 * The modal never mutates anything — it returns a final set of decisions
 * to the caller which then commits to the store. This keeps the modal
 * a pure view over the diff result.
 */

export type ResolutionChoice = 'keep_existing' | 'use_new' | 'skip';

export interface ReingestDecision {
  itemIndex: number;
  choice: ResolutionChoice;
}

export interface ReingestReviewModalProps {
  open: boolean;
  doc: IngestedDocument | null;
  diff: DiffOutcome | null;
  onCancel: () => void;
  /** Called when the user applies the import. Receives the resolution
   *  decisions for pending-review items. Caller composes the final chunk
   *  list (toInsert minus skipped, toArchive plus accepted replacements). */
  onApply: (decisions: ReingestDecision[]) => void;
}

export function ReingestReviewModal({
  open, doc, diff, onCancel, onApply,
}: ReingestReviewModalProps) {
  const [screen, setScreen] = useState<'summary' | 'pager'>('summary');
  const [decisions, setDecisions] = useState<Record<number, ResolutionChoice>>({});
  const [currentIndex, setCurrentIndex] = useState(0);

  const pending = diff?.pendingReview ?? [];
  const resolvedCount = Object.keys(decisions).length;
  const allResolved = pending.length > 0 && resolvedCount >= pending.length;

  const nextUnresolvedIndex = useMemo(() => {
    for (let i = 0; i < pending.length; i++) {
      if (decisions[i] === undefined) return i;
    }
    return -1;
  }, [pending, decisions]);

  if (!doc || !diff) return null;

  // Unsaved work = anything the user would lose if they dismiss the modal.
  // Unchanged chunks aren't "work" — they're trivially recomputed.
  const hasUnsavedWork = diff.summary.newCount > 0 || diff.summary.pendingCount > 0;

  const requestClose = () => {
    if (!hasUnsavedWork) { onCancel(); return; }
    const parts: string[] = [];
    if (diff.summary.newCount > 0) parts.push(`${diff.summary.newCount} new fact${diff.summary.newCount !== 1 ? 's' : ''}`);
    if (diff.summary.pendingCount > 0) parts.push(`${diff.summary.pendingCount} pending review${diff.summary.pendingCount !== 1 ? 's' : ''}`);
    const confirmed = window.confirm(
      `Discard ${parts.join(' and ')} from "${doc.filename}"?\n\n` +
      `The AI tokens spent analyzing this document will be wasted — re-importing will require another full analysis.`
    );
    if (confirmed) onCancel();
  };

  const goToPager = () => {
    setCurrentIndex(nextUnresolvedIndex >= 0 ? nextUnresolvedIndex : 0);
    setScreen('pager');
  };

  const makeChoice = (choice: ResolutionChoice) => {
    setDecisions(prev => ({ ...prev, [currentIndex]: choice }));
    // Auto-advance
    const next = findNextUnresolved(currentIndex, pending.length, { ...decisions, [currentIndex]: choice });
    if (next >= 0) {
      setCurrentIndex(next);
    } else {
      setScreen('summary');
    }
  };

  const handleApply = () => {
    const decisionList: ReingestDecision[] = Object.entries(decisions).map(([k, v]) => ({
      itemIndex: Number(k), choice: v,
    }));
    // Items the user skipped or hasn't seen → default to keep_existing
    // (conservative: don't break what's working).
    for (let i = 0; i < pending.length; i++) {
      if (decisions[i] === undefined) {
        decisionList.push({ itemIndex: i, choice: 'keep_existing' });
      }
    }
    onApply(decisionList);
    // Reset internal state so the next open starts fresh.
    setScreen('summary');
    setDecisions({});
    setCurrentIndex(0);
  };

  const s = diff.summary;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) requestClose(); }} modal={false}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] flex flex-col"
        // Block backdrop clicks entirely — with a floating Debug panel at
        // z-[9999], the user's click-on-debug was being read by Radix as a
        // click-outside and silently closing the modal, nuking the import.
        // Only explicit Cancel / X / Escape can close (all routed through
        // requestClose so real work prompts for confirmation).
        onPointerDownOutside={e => e.preventDefault()}
        onInteractOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => { e.preventDefault(); requestClose(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw size={18} className="text-indigo-600" />
            {screen === 'summary' ? 'Re-import Review' : `Review ${currentIndex + 1} of ${pending.length}`}
          </DialogTitle>
          <DialogDescription>
            {screen === 'summary'
              ? <>Analyzing changes in <span className="font-medium">{doc.filename}</span></>
              : <>Your edit vs the new document — pick which wins.</>
            }
          </DialogDescription>
        </DialogHeader>

        {screen === 'summary' ? (
          <SummaryScreen
            summary={s}
            resolvedCount={resolvedCount}
            pendingTotal={pending.length}
            onReview={goToPager}
          />
        ) : (
          <PagerScreen
            item={pending[currentIndex]}
            currentIndex={currentIndex}
            total={pending.length}
            choice={decisions[currentIndex]}
            onBack={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
            onNext={() => setCurrentIndex(Math.min(pending.length - 1, currentIndex + 1))}
            onChoose={makeChoice}
          />
        )}

        <DialogFooter className="flex-row gap-2 sm:justify-between">
          {screen === 'pager' ? (
            <Button variant="ghost" onClick={() => setScreen('summary')}>
              <ChevronLeft size={16} className="mr-1" /> Back to summary
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={requestClose}>Cancel</Button>
            {screen === 'summary' && (
              <Button onClick={handleApply} disabled={pending.length > 0 && !allResolved}>
                {pending.length === 0
                  ? <>Apply {s.newCount} changes</>
                  : allResolved
                    ? <><CheckCircle2 size={16} className="mr-1" /> Apply all</>
                    : `Review ${pending.length - resolvedCount} more first`}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Summary screen ──────────────────────────────────────────────────

function SummaryScreen({
  summary, resolvedCount, pendingTotal, onReview,
}: {
  summary: DiffOutcome['summary'];
  resolvedCount: number;
  pendingTotal: number;
  onReview: () => void;
}) {
  return (
    <ScrollArea className="flex-1 pr-4">
      <div className="space-y-2">
        <SummaryLine icon={<Sparkles size={16} className="text-emerald-600" />}
          count={summary.newCount} label="new facts" tone="emerald" />
        <SummaryLine icon={<ShieldCheck size={16} className="text-slate-400" />}
          count={summary.unchangedCount} label="unchanged" tone="slate" />
        <SummaryLine icon={<Archive size={16} className="text-slate-500" />}
          count={summary.archivedCount} label="archived (removed in new version)" tone="slate" />
        {pendingTotal > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={onReview}
              className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors"
            >
              <span className="flex items-center gap-2 text-amber-900 font-medium">
                <AlertTriangle size={16} className="text-amber-600" />
                {pendingTotal} need{pendingTotal === 1 ? 's' : ''} review
                {resolvedCount > 0 && (
                  <Badge variant="secondary" className="ml-2 bg-amber-200 text-amber-900 hover:bg-amber-200">
                    {resolvedCount} done
                  </Badge>
                )}
              </span>
              <ChevronRight size={16} className="text-amber-700" />
            </button>
          </div>
        )}

        <Separator className="my-3" />
        <div className="text-xs text-slate-500 leading-relaxed">
          <strong>How this works:</strong> Facts you edited manually (overrides) are never silently overwritten.
          When the new document disagrees with your edits, you'll be asked to pick a winner.
          Archived chunks are kept for 90 days in case you want to roll back.
        </div>
      </div>
    </ScrollArea>
  );
}

function SummaryLine({
  icon, count, label, tone,
}: {
  icon: React.ReactNode;
  count: number;
  label: string;
  tone: 'emerald' | 'slate';
}) {
  const colorClass = tone === 'emerald' ? 'text-emerald-700' : 'text-slate-600';
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      {icon}
      <span className={`font-semibold ${colorClass}`}>{count}</span>
      <span className="text-slate-600">{label}</span>
    </div>
  );
}

// ─── Pager screen ──────────────────────────────────────────────────────

function PagerScreen({
  item, currentIndex, total, choice, onBack, onNext, onChoose,
}: {
  item: PendingReviewItem;
  currentIndex: number;
  total: number;
  choice: ResolutionChoice | undefined;
  onBack: () => void;
  onNext: () => void;
  onChoose: (c: ResolutionChoice) => void;
}) {
  const reasonCopy = REASON_COPY[item.reason];

  return (
    <ScrollArea className="flex-1 pr-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{reasonCopy.label}</span>
          <span>{currentIndex + 1} / {total}</span>
        </div>

        <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
          <div className="text-xs text-slate-500 mb-1">Slot</div>
          <div className="text-sm font-medium text-slate-900">
            {item.existing?.title || item.proposed?.title || '(unnamed)'}
          </div>
          <div className="text-xs text-slate-500 mt-1 font-mono">
            {item.existing?.slotKey || item.proposed?.slotKey || '(free-form)'}
          </div>
        </div>

        {item.existing && (
          <ValuePanel
            icon={item.existing.isOverride ? '🟢' : '📄'}
            label={item.existing.isOverride ? 'Your edit' : 'Current'}
            chunk={item.existing}
          />
        )}

        {item.proposed && (
          <ValuePanel
            icon="📄"
            label="New document"
            chunk={item.proposed}
          />
        )}

        {!item.proposed && item.reason === 'missing_slot' && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
            <AlertTriangle size={14} className="inline mr-1" />
            The AI didn't find this slot in the new document. This may mean the value was removed
            — or the AI just missed it. Pick "Keep current" if you're unsure.
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 pt-2">
          <Button
            variant={choice === 'keep_existing' ? 'default' : 'outline'}
            onClick={() => onChoose('keep_existing')}
            size="sm"
          >
            Keep current
          </Button>
          <Button
            variant={choice === 'use_new' ? 'default' : 'outline'}
            onClick={() => onChoose('use_new')}
            size="sm"
            disabled={!item.proposed}
          >
            Use new
          </Button>
          <Button
            variant={choice === 'skip' ? 'default' : 'outline'}
            onClick={() => onChoose('skip')}
            size="sm"
          >
            Skip
          </Button>
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="ghost" size="sm" onClick={onBack} disabled={currentIndex === 0}>
            <ChevronLeft size={14} className="mr-1" /> Previous
          </Button>
          <Button variant="ghost" size="sm" onClick={onNext} disabled={currentIndex === total - 1}>
            Next <ChevronRight size={14} className="ml-1" />
          </Button>
        </div>
      </div>
    </ScrollArea>
  );
}

function ValuePanel({
  icon, label, chunk,
}: {
  icon: string;
  label: string;
  chunk: KnowledgeChunk;
}) {
  const src = chunk.source;
  return (
    <div className="p-3 rounded-lg bg-white border border-slate-200">
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
        <span>{icon}</span>
        <span className="font-medium text-slate-700">{label}</span>
        {src.editedBy && <span>• {src.editedBy}</span>}
        {src.extractedAt && <span>• {new Date(src.extractedAt).toLocaleDateString()}</span>}
      </div>
      <div className="text-sm text-slate-900 whitespace-pre-wrap">{chunk.body}</div>
      {src.originalText && src.originalText !== chunk.body && (
        <details className="mt-2">
          <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700">
            <FileText size={11} className="inline mr-1" />
            Show original from source
          </summary>
          <pre className="mt-1 text-xs text-slate-600 bg-slate-50 p-2 rounded whitespace-pre-wrap font-mono">
            {src.originalText}
          </pre>
        </details>
      )}
    </div>
  );
}

const REASON_COPY: Record<PendingReviewItem['reason'], { label: string }> = {
  override_conflict: { label: 'Your edit conflicts with the new document' },
  missing_slot: { label: 'Previously set, not in new document' },
  low_confidence: { label: 'AI is uncertain — verify before using' },
  unmapped_fact: { label: "AI found a fact but couldn't map it to a field" },
};

function findNextUnresolved(
  from: number,
  total: number,
  decisions: Record<number, ResolutionChoice>,
): number {
  for (let i = from + 1; i < total; i++) {
    if (decisions[i] === undefined) return i;
  }
  for (let i = 0; i <= from; i++) {
    if (decisions[i] === undefined) return i;
  }
  return -1;
}

// ─── Post-ingest undo strip ───────────────────────────────────────────

export function ReingestUndoToast({
  doc, summary, onUndo,
}: {
  doc: IngestedDocument;
  summary: DiffOutcome['summary'];
  onUndo: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-white border border-slate-200 shadow-sm">
      <CheckCircle2 size={16} className="text-emerald-600" />
      <div className="flex-1 text-sm">
        <div className="font-medium text-slate-900">Re-imported {doc.filename}</div>
        <div className="text-xs text-slate-500">
          {summary.newCount} added · {summary.archivedCount} archived · {summary.pendingCount} resolved
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onUndo}>
        <Undo2 size={14} className="mr-1" /> Undo
      </Button>
    </div>
  );
}

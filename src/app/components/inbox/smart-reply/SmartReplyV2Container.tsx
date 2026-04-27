import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Info, Shield, Pencil } from 'lucide-react';
import { cn } from '@/app/components/ui/utils';
import { SmartReplyHeader } from './SmartReplyHeader';
import { InquiryCard } from './InquiryCard';
import { useComposeStructured } from './useComposeStructured';
import type { DetectedInquiry } from '../InquiryDetector';
import type { Ticket } from '../../../data/types';

interface Props {
  ticket: Ticket;
  existingDraft: string;
  onInsert: (text: string) => void;
  onHide: () => void;
  aiInquiries?: DetectedInquiry[];
}

/**
 * SmartReply v2 — single flat panel. No phases.
 *
 *   Header
 *   Banners (typed-draft collision / legacy / aggregate-stale / safety)
 *   Scroll region — one InquiryCard per detected inquiry (not-covered first)
 *
 * Assembled text binds DIRECTLY to the compose box below via onInsert:
 * there's no separate preview or Insert button. The reply box IS the
 * preview — single source of truth, lower cognitive load. See the
 * live-sync effect below for the collision-safe guard.
 *
 * Visually the panel sits flush against the reply box (no bottom margin,
 * no bottom radius) so the cards + compose read as one surface.
 */
export function SmartReplyV2Container({
  ticket,
  existingDraft,
  onInsert,
  onHide,
  aiInquiries,
}: Props) {
  const {
    draft,
    inquiries,
    assembledText,
    staleKeys,
    isGenerating,
    generatingKeys,
    isLegacyDraft,
    handledCount,
    regenerateSection,
    regenerateAll,
    editSection,
    skipSection,
    markSynced,
  } = useComposeStructured({ ticket, existingDraft, aiInquiries });

  // Aggregate staleness: only show the top banner when EVERY section drifted.
  // Otherwise the per-card stale pills are enough and the top banner would
  // be noise.
  const allStale = draft
    && Object.keys(draft.sections).length > 0
    && staleKeys.size === Object.keys(draft.sections).length;

  const safetyFlagged = draft?.safetyFlagged === true;
  const highRisk = draft && draft.riskScore >= 8;

  // Live-bind assembled text to the reply box. Skips two states:
  //   - `pending`: the agent hasn't resolved the typed-draft banner yet —
  //     don't clobber their typed text until they pick replace/incorporate.
  //   - `keep`: the agent explicitly said "don't touch my text" and hid the
  //     panel; any stray re-render shouldn't overwrite it.
  // Fires on every assembly change (edit/regen/skip debounced by the hook).
  // Explicit apply model: the reply box is NEVER auto-written on open —
  // agent retains whatever they typed. They click "Apply to reply box"
  // when they're ready to commit the AI draft. Once applied, subsequent
  // card edits live-sync into the reply box (connected editing).
  //
  // Exception: if the reply box was empty at open, we auto-apply the first
  // compose result — there's nothing to preserve, and the friction of an
  // explicit click buys nothing.
  const lastSyncedRef = useRef<string>('');
  const [hasApplied, setHasApplied] = useState<boolean>(() => existingDraft.trim().length === 0);

  useEffect(() => {
    if (!hasApplied) return;
    const text = assembledText.trim();
    if (!text) return;
    if (text === lastSyncedRef.current) return;
    lastSyncedRef.current = text;
    onInsert(text);
    markSynced(text);
  }, [hasApplied, assembledText, onInsert, markSynced]);

  const handleApply = () => {
    setHasApplied(true);
    // First apply: fire immediately so agent sees the reply box update
    // without waiting for the effect cycle.
    const text = assembledText.trim();
    if (text && text !== lastSyncedRef.current) {
      lastSyncedRef.current = text;
      onInsert(text);
      markSynced(text);
    }
  };

  return (
    <div
      className={cn(
        '[background:linear-gradient(274.51deg,#D7EFFF_-72.01%,#FFFFFF_125.6%)]',
        'mx-3 rounded-t-xl border border-b-0 border-indigo-200 shadow-sm overflow-hidden',
        'shrink-0 animate-in fade-in slide-in-from-bottom-2 duration-200',
        'flex flex-col max-h-[60vh]',
      )}
    >
      <SmartReplyHeader
        onAction={onHide}
        actionLabel="Hide"
        subtitle={isGenerating ? 'Composing…' : undefined}
      />

      {/* ─── Top banners ──────────────────────────────────── */}


      {isLegacyDraft && (
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200 text-[11px] text-slate-700">
          <Info size={12} className="shrink-0 text-slate-500" />
          <span className="flex-1 min-w-0">
            Legacy draft detected. Regenerate to upgrade to per-section editing.
          </span>
          <button
            type="button"
            onClick={() => void regenerateAll()}
            className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Regenerate
          </button>
        </div>
      )}

      {allStale && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-900">
          <AlertCircle size={12} className="shrink-0 text-amber-600" />
          <span className="flex-1 min-w-0">
            New messages since this draft — regenerate or review each section.
          </span>
          <button
            type="button"
            onClick={() => void regenerateAll()}
            className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-600 text-white hover:bg-amber-700"
          >
            Regenerate all
          </button>
        </div>
      )}

      {(safetyFlagged || highRisk) && (
        <div className="flex items-center gap-2 px-3 py-2 bg-rose-50 border-b border-rose-200 text-[11px] text-rose-900">
          <Shield size={12} className="shrink-0 text-rose-600" />
          <span className="flex-1 min-w-0">
            {highRisk
              ? 'High risk — this reply will route to an agent if sent as-is.'
              : 'Time-commitment phrase flagged — review before sending.'}
          </span>
        </div>
      )}

      {/* ─── Cards (scroll region) — last element in the panel; the reply
            box below it is the live preview. No footer, no Insert button. */}

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
        {inquiries.length === 0 ? (
          <div className="text-center text-[11px] text-slate-500 py-4">
            {handledCount > 0
              ? `All ${handledCount} inquiries have already been addressed.`
              : 'No inquiries detected yet.'}
          </div>
        ) : (
          <>
            {inquiries.map(inq => (
              <InquiryCard
                key={inq.inquiryKey}
                inquiry={inq}
                section={draft?.sections[inq.inquiryKey]}
                isGenerating={(isGenerating && !draft) || generatingKeys.has(inq.inquiryKey)}
                isStale={staleKeys.has(inq.inquiryKey)}
                onEdit={(text) => editSection(inq.inquiryKey, text)}
                onRegenerate={(note) => void regenerateSection(inq.inquiryKey, note)}
                onSkip={(skipped) => skipSection(inq.inquiryKey, skipped)}
              />
            ))}
            {handledCount > 0 && (
              <div className="text-center text-[10px] text-slate-400 pt-1">
                {handledCount} {handledCount === 1 ? 'inquiry' : 'inquiries'} already addressed earlier — not shown.
              </div>
            )}
          </>
        )}
      </div>

      {/* Apply footer — only shown until the agent opts into the connection.
          Pre-apply: reply box retains whatever the agent had typed; cards
          sit ready. One click commits the AI draft to the reply box, after
          which card edits live-sync there too. */}
      {!hasApplied && assembledText.trim().length > 0 && (
        <div className="border-t border-slate-200 bg-white/80 px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-500 leading-snug">
            Your typed draft is preserved in the reply box. Apply to replace it with the AI draft.
          </span>
          <button
            type="button"
            onClick={handleApply}
            className="shrink-0 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 shadow-sm transition-all active:scale-95 flex items-center gap-1.5"
          >
            <Pencil size={12} />
            Apply to reply box
          </button>
        </div>
      )}
    </div>
  );
}

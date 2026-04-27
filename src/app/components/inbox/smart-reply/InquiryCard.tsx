import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, Pencil, Ban, AlertTriangle, Clock, BookOpen } from 'lucide-react';
import type { DetectedInquiry } from '../InquiryDetector';
import type { StoredSection } from '../../../../lib/ai-draft-cache';

interface Props {
  inquiry: DetectedInquiry;
  section: StoredSection | undefined;
  isGenerating: boolean;
  isStale: boolean;
  onEdit: (text: string) => void;
  onRegenerate: (note?: string) => void;
  onSkip: (skipped: boolean) => void;
}

/**
 * One row per detected inquiry. Owns the inline textarea for edit, a small
 * icon-action row (Regenerate, Note→Regen, Skip), and a collapsible note
 * input. Amber left-border + "Needs your input" pill flag sections the KB
 * didn't cover so the agent's eye lands on them first.
 */
export function InquiryCard({
  inquiry,
  section,
  isGenerating,
  isStale,
  onEdit,
  onRegenerate,
  onSkip,
}: Props) {
  const covered = section?.covered ?? false;
  const isSkipped = section?.isSkipped ?? false;
  const text = section?.text ?? '';

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-size the textarea to its content, capped at max-h-40 (~160px).
  // Falls back to CSS min-h when empty so the card has a consistent height.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const handleNoteSubmit = () => {
    const trimmed = noteText.trim();
    onRegenerate(trimmed || undefined);
    setNoteOpen(false);
    setNoteText('');
  };

  const borderClass = isSkipped
    ? 'border-l-slate-300 bg-slate-50/60 opacity-70'
    : !covered
      ? 'border-l-amber-400'
      : 'border-l-indigo-300';

  return (
    <div
      className={`border-l-2 ${borderClass} bg-white rounded-r-md px-3 py-2.5 shadow-sm`}
    >
      {/* Header row */}
      <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
        <span className="text-[11px] font-semibold text-slate-700 flex-1 min-w-0 truncate">
          {inquiry.label}
        </span>

        {/* KB coverage pill — shown only when KB backed the section so the
            agent knows the text is grounded. Not-covered sections signal via
            the amber left-border stripe + amber placeholder in the textarea;
            adding a pill here would double-encode the same warning. */}
        {!isSkipped && covered && (
          <span className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full border bg-emerald-50 text-emerald-600 border-emerald-200">
            <BookOpen size={8} />
            KB covered
          </span>
        )}

        {isStale && !isSkipped && (
          <span className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            <Clock size={8} />
            Stale
          </span>
        )}

        {isSkipped && (
          <span className="text-[9px] font-medium text-slate-500 italic">
            Skipped
          </span>
        )}
      </div>

      {/* Body — editable textarea, or shimmer while regenerating */}
      {isGenerating ? (
        <div className="h-16 rounded bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 animate-pulse" />
      ) : (
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => onEdit(e.target.value)}
          disabled={isSkipped}
          placeholder={
            !covered
              ? 'Write your response here…'
              : 'AI will fill this in'
          }
          className={`w-full text-xs leading-relaxed bg-transparent border-0 resize-none focus:outline-none focus:ring-0 px-0 py-0 min-h-[48px] max-h-40 ${
            !covered && !text
              ? 'placeholder:text-amber-500/70'
              : 'placeholder:text-slate-400'
          } ${isSkipped ? 'text-slate-400 line-through' : 'text-slate-700'}`}
        />
      )}

      {/* Note input — slides down when user clicks the pencil */}
      {noteOpen && !isGenerating && (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            type="text"
            autoFocus
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNoteSubmit();
              if (e.key === 'Escape') { setNoteOpen(false); setNoteText(''); }
            }}
            placeholder="Tell AI what to say (optional)"
            className="flex-1 text-[11px] border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-indigo-400"
          />
          <button
            type="button"
            onClick={handleNoteSubmit}
            className="px-2 py-1 bg-indigo-600 text-white text-[10px] font-medium rounded hover:bg-indigo-700"
          >
            Regen
          </button>
        </div>
      )}

      {/* Action row — tiny icon buttons */}
      {!isGenerating && (
        <div className="mt-1.5 flex items-center gap-2 text-slate-400">
          <button
            type="button"
            onClick={() => onRegenerate()}
            disabled={isSkipped}
            title="Regenerate this section"
            className="hover:text-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw size={11} />
          </button>
          <button
            type="button"
            onClick={() => setNoteOpen(v => !v)}
            disabled={isSkipped}
            title="Regenerate with a note"
            className={`hover:text-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${noteOpen ? 'text-indigo-600' : ''}`}
          >
            <Pencil size={11} />
          </button>
          <button
            type="button"
            onClick={() => onSkip(!isSkipped)}
            title={isSkipped ? 'Include this section' : 'Skip this section'}
            className={`hover:text-slate-700 transition-colors ${isSkipped ? 'text-slate-600' : ''}`}
          >
            <Ban size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

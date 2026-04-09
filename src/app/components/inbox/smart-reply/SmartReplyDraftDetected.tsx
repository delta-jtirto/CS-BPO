import React from 'react';
import { Pencil, Wand2, Sparkles } from 'lucide-react';
import { SmartReplyHeader } from './SmartReplyHeader';
import type { SmartReplyState, SmartReplyPanelProps } from './types';
import type { InquiryDecision } from '../InquiryDetector';

type Props = Pick<SmartReplyPanelProps, 'existingDraft' | 'onHide'> &
  Pick<SmartReplyState, 'doPolish' | 'doCompose' | 'inquiries' | 'setDecisions' | 'composeTriggered' | 'hasApiKey'>;

export function SmartReplyDraftDetected({
  existingDraft,
  onHide,
  doPolish,
  doCompose,
  inquiries,
  setDecisions,
  composeTriggered,
  hasApiKey,
}: Props) {
  const truncatedDraft = existingDraft.length > 80
    ? existingDraft.slice(0, 80) + '...'
    : existingDraft;

  const handleComposeFresh = () => {
    composeTriggered.current = true;
    const yesDecisions: Record<string, 'yes' | 'no'> = {};
    const autoInquiryDecisions: Record<string, InquiryDecision> = {};
    for (const inq of inquiries) {
      yesDecisions[inq.id] = 'yes';
      autoInquiryDecisions[inq.id] = { inquiryId: inq.id, decision: 'yes' };
    }
    setDecisions(yesDecisions);
    doCompose(autoInquiryDecisions);
  };

  return (
    <>
      <SmartReplyHeader onAction={onHide} actionLabel="Hide" />

      <div className="px-4 pb-3">
        <div className="flex items-start gap-2 mb-3 p-2.5 bg-slate-50 rounded-lg border border-slate-100">
          <Pencil size={12} className="text-slate-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">Your draft</span>
            <p className="text-xs text-slate-600 leading-relaxed truncate">{truncatedDraft}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              composeTriggered.current = true;
              doPolish(existingDraft);
            }}
            className="flex-1 px-3 py-2.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 shadow-sm transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
          >
            <Wand2 size={13} /> Polish my draft
          </button>
          <button
            onClick={handleComposeFresh}
            className="flex-1 px-3 py-2.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5"
          >
            <Sparkles size={13} /> Compose fresh
          </button>
        </div>
        {!hasApiKey && (
          <p className="text-[9px] text-amber-500 mt-1.5 text-center">Polish requires an API key — will use your draft as-is</p>
        )}
      </div>
    </>
  );
}

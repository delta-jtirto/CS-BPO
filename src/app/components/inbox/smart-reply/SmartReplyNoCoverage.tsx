import React from 'react';
import { AlertTriangle, MessageSquare, Pencil } from 'lucide-react';
import { SmartReplyHeader } from './SmartReplyHeader';
import type { SmartReplyState, SmartReplyPanelProps } from './types';

type Props = Pick<SmartReplyPanelProps, 'onHide' | 'ticket'> &
  Pick<SmartReplyState, 'uncoveredLabels' | 'inquiries' | 'setExpandedCustom' | 'setPhase' | 'composeTriggered' | 'agentName'> & {
    setComposedMessage: (msg: string) => void;
  };

export function SmartReplyNoCoverage({
  onHide,
  ticket,
  uncoveredLabels,
  inquiries,
  setExpandedCustom,
  setPhase,
  composeTriggered,
  agentName,
  setComposedMessage,
}: Props) {
  return (
    <>
      <SmartReplyHeader
        onAction={onHide}
        actionLabel="Hide"
        badge={
          <span className="text-[8px] font-bold text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full">No coverage</span>
        }
        icon="sparkles"
      />

      <div className="px-4 pb-3">
        <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg mb-3">
          <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-[11px] font-semibold text-amber-800">
              Your knowledge base doesn't cover {uncoveredLabels.length === 1 ? `"${uncoveredLabels[0]}"` : 'what this guest is asking about'}
            </p>
            <p className="text-[10px] text-amber-600 mt-0.5 leading-relaxed">
              AI can't compose a reliable reply without knowledge base data. You can write your own response, provide the answers yourself, or send a holding message.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 mb-3">
          {uncoveredLabels.map((label, i) => (
            <span key={i} className="text-[9px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-0.5">
              <AlertTriangle size={7} /> {label}
            </span>
          ))}
        </div>

        <div className="space-y-1.5">
          <button
            onClick={() => {
              const guestFirst = ticket.guestName.split(' ')[0];
              const holding = `Hi ${guestFirst},\n\nThank you for reaching out! I'm looking into this and will get back to you shortly.\n\nBest,\n${agentName}`;
              setComposedMessage(holding);
              composeTriggered.current = true;
              setPhase('preview');
            }}
            className="w-full px-3 py-2.5 bg-amber-500 text-white text-xs font-medium rounded-lg hover:bg-amber-600 shadow-sm transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
          >
            <MessageSquare size={13} /> Send a holding message
          </button>
          <button
            onClick={() => {
              composeTriggered.current = true;
              if (inquiries.length > 0) setExpandedCustom(inquiries[0].id);
              setPhase('configure');
            }}
            className="w-full px-3 py-2.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5"
          >
            <Pencil size={13} /> I know the answers — compose with my notes
          </button>
          <button
            onClick={onHide}
            className="w-full px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors flex items-center justify-center gap-1.5"
          >
            I'll write my own reply
          </button>
        </div>
      </div>
    </>
  );
}

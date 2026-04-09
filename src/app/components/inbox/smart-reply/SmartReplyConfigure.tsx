import React from 'react';
import { Sparkles } from 'lucide-react';
import { ScrollArea } from '@/app/components/ui/scroll-area';
import { SmartReplyHeader } from './SmartReplyHeader';
import { InquiryDecisionRow } from './InquiryDecisionRow';
import type { SmartReplyState } from './types';

type Props = Pick<SmartReplyState, 'inquiries' | 'kbMatchesByInquiry' | 'decisions' | 'customTexts' | 'setDecisions' | 'setCustomTexts' | 'setPhase' | 'handleRecompose' | 'composedMessage'>;

export function SmartReplyConfigure({
  inquiries,
  kbMatchesByInquiry,
  decisions,
  customTexts,
  setDecisions,
  setCustomTexts,
  setPhase,
  handleRecompose,
  composedMessage,
}: Props) {
  const handleDecisionChange = (id: string, decision: 'yes' | 'no') => {
    setDecisions(prev => ({ ...prev, [id]: decision }));
  };

  const handleCustomTextChange = (id: string, text: string) => {
    setCustomTexts(prev => ({ ...prev, [id]: text }));
  };

  return (
    <>
      <SmartReplyHeader
        title="Fine-tune Reply"
        subtitle="Adjust what the AI includes"
        icon="settings"
        onAction={() => setPhase(composedMessage ? 'preview' : 'analyzing')}
        actionLabel={composedMessage ? 'Back' : 'Cancel'}
      />

      <div className="px-4 pb-2">
        <ScrollArea className="max-h-40">
          <div className="space-y-3">
            {inquiries.map(inq => (
              <InquiryDecisionRow
                key={inq.id}
                inquiry={inq}
                kbMatches={kbMatchesByInquiry[inq.id] || []}
                decision={decisions[inq.id]}
                customText={customTexts[inq.id] || ''}
                onDecisionChange={handleDecisionChange}
                onCustomTextChange={handleCustomTextChange}
              />
            ))}
          </div>
        </ScrollArea>
      </div>

      <div className="px-4 py-2.5 flex justify-end border-t border-slate-100">
        <button
          onClick={handleRecompose}
          className="px-4 py-2 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 shadow-sm transition-all active:scale-95 flex items-center gap-1.5"
        >
          <Sparkles size={12} /> Recompose
        </button>
      </div>
    </>
  );
}

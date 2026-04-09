import React from 'react';
import { cn } from '@/app/components/ui/utils';
import { SmartReplyDraftDetected } from './SmartReplyDraftDetected';
import { SmartReplyAnalyzing } from './SmartReplyAnalyzing';
import { SmartReplyNoCoverage } from './SmartReplyNoCoverage';
import { SmartReplyPreview } from './SmartReplyPreview';
import { SmartReplyConfigure } from './SmartReplyConfigure';
import type { SmartReplyState, SmartReplyPanelProps } from './types';

type Props = SmartReplyPanelProps & SmartReplyState;

export function SmartReplyContainer(props: Props) {
  const { phase, allUncovered } = props;

  return (
    <div
      className={cn(
        '[background:linear-gradient(274.51deg,#D7EFFF_-72.01%,#FFFFFF_125.6%)]',
        'mx-3 mb-1 rounded-xl border border-indigo-200 shadow-sm overflow-hidden',
        'shrink-0 animate-in fade-in slide-in-from-bottom-2 duration-200',
      )}
    >
      {phase === 'draft-detected' && (
        <SmartReplyDraftDetected
          existingDraft={props.existingDraft}
          onHide={props.onHide}
          doPolish={props.doPolish}
          doCompose={props.doCompose}
          inquiries={props.inquiries}
          setDecisions={props.setDecisions}
          composeTriggered={props.composeTriggered}
          hasApiKey={props.hasApiKey}
        />
      )}

      {phase === 'analyzing' && allUncovered && (
        <SmartReplyNoCoverage
          onHide={props.onHide}
          ticket={props.ticket}
          uncoveredLabels={props.uncoveredLabels}
          inquiries={props.inquiries}
          setExpandedCustom={props.setExpandedCustom}
          setPhase={props.setPhase}
          composeTriggered={props.composeTriggered}
          agentName={props.agentName}
          setComposedMessage={props.setComposedMessage}
        />
      )}

      {(phase === 'analyzing' || phase === 'composing') && !allUncovered && (
        <SmartReplyAnalyzing
          phase={props.phase}
          hasApiKey={props.hasApiKey}
          onHide={props.onHide}
        />
      )}

      {phase === 'preview' && (
        <SmartReplyPreview
          onHide={props.onHide}
          onInsert={props.onInsert}
          cacheRef={props.cacheRef}
          composedMessage={props.composedMessage}
          inquiries={props.inquiries}
          kbMatchesByInquiry={props.kbMatchesByInquiry}
          decisions={props.decisions}
          customTexts={props.customTexts}
          coveredCount={props.coveredCount}
          uncoveredCount={props.uncoveredCount}
          hasApiKey={props.hasApiKey}
          setPhase={props.setPhase}
          cacheKey={props.cacheKey}
        />
      )}

      {phase === 'configure' && (
        <SmartReplyConfigure
          inquiries={props.inquiries}
          kbMatchesByInquiry={props.kbMatchesByInquiry}
          decisions={props.decisions}
          customTexts={props.customTexts}
          setDecisions={props.setDecisions}
          setCustomTexts={props.setCustomTexts}
          setPhase={props.setPhase}
          handleRecompose={props.handleRecompose}
          composedMessage={props.composedMessage}
        />
      )}
    </div>
  );
}

import React from 'react';
import { useAppContext } from '../../context/AppContext';
import { useSmartReply } from './smart-reply/useSmartReply';
import { SmartReplyContainer } from './smart-reply/SmartReplyContainer';
import { SmartReplyV2Container } from './smart-reply/SmartReplyV2Container';
import type { SmartReplyPanelProps } from './smart-reply/types';

export type { SmartReplyCache } from './smart-reply/types';
export type { SmartReplyPanelProps } from './smart-reply/types';

export function SmartReplyPanel(props: SmartReplyPanelProps) {
  const { hostSettings } = useAppContext();
  const hostConfig = hostSettings.find(s => s.hostId === props.ticket.host.id);
  // Per-host opt-in to SmartReply v2. Default false keeps existing behavior
  // until the host (or settings UI) flips `smartReplyV2`.
  if (hostConfig?.smartReplyV2) {
    return (
      <SmartReplyV2Container
        ticket={props.ticket}
        existingDraft={props.existingDraft}
        onInsert={props.onInsert}
        onHide={props.onHide}
        aiInquiries={props.aiInquiries}
      />
    );
  }
  return <V1Panel {...props} />;
}

function V1Panel(props: SmartReplyPanelProps) {
  const smartReply = useSmartReply(props);
  return <SmartReplyContainer {...props} {...smartReply} />;
}

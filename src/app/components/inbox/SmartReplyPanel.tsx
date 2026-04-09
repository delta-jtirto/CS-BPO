import React from 'react';
import { useSmartReply } from './smart-reply/useSmartReply';
import { SmartReplyContainer } from './smart-reply/SmartReplyContainer';
import type { SmartReplyPanelProps, SmartReplyCache } from './smart-reply/types';

export type { SmartReplyCache } from './smart-reply/types';
export type { SmartReplyPanelProps } from './smart-reply/types';

export function SmartReplyPanel(props: SmartReplyPanelProps) {
  const smartReply = useSmartReply(props);
  return <SmartReplyContainer {...props} {...smartReply} />;
}

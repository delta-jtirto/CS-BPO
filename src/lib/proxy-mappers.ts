/**
 * Map Channel Proxy data (Supabase) to AI BPO types (Ticket, Message).
 * Mirrors the pattern in firestore-mappers.ts but for proxy channels.
 */

import type { Host, Message, Ticket } from '@/app/data/types';
import { channelDisplayName, channelToIcon } from './channel-config';
import { computeSLA, formatSLARelative, type EscalationOverride } from './compute-ticket-state';
import type { ProxyConversation, ProxyMessage } from '@/hooks/use-proxy-conversations';

// ---------------------------------------------------------------------------
// ProxyConversation → Ticket
// ---------------------------------------------------------------------------

export function mapProxyConversationToTicket(
  conversation: ProxyConversation,
  host: Host,
  companyName: string,
  resolvedAt?: number | null,
  escalationOverride?: EscalationOverride | null,
): Ticket {
  const contact = conversation.contacts as unknown as {
    display_name: string | null;
    avatar_url: string | null;
    channel_contact_id: string;
  };

  const lastMessageAtMs = conversation.last_message_at
    ? new Date(conversation.last_message_at).getTime()
    : Date.now();

  const slaResult = computeSLA(
    lastMessageAtMs,
    null,
    resolvedAt ?? undefined,
    escalationOverride,
  );
  const status = slaResult.resolved
    ? 'normal'
    : slaResult.status === 'stale'
      ? 'urgent'
      : slaResult.status;
  const sla = slaResult.resolved ? '' : formatSLARelative(slaResult.sla);

  return {
    id: `proxy_${conversation.id}`,
    guestName: contact?.display_name || contact?.channel_contact_id || 'Unknown',
    channel: channelDisplayName(conversation.channel),
    channelIcon: channelToIcon(conversation.channel),
    host,
    property: '',
    room: '',
    status,
    sla,
    slaSetAt: lastMessageAtMs,
    aiHandoverReason: '',
    summary: conversation.last_message_preview || '',
    tags: [],
    language: '',
    messages: undefined, // lazy-loaded via useProxyMessages
    unreadCount: conversation.unread_count,
    companyName,
    // Proxy linkage
    proxyConversationId: conversation.id,
    proxyCompanyId: conversation.company_id,
    proxyChannel: conversation.channel,
    // No Firestore linkage
    firestoreThreadId: undefined,
    firestoreHostId: undefined,
    firestoreGuestUserId: undefined,
  };
}

// ---------------------------------------------------------------------------
// ProxyMessage → Message
// ---------------------------------------------------------------------------

let _proxyMessageIdCounter = 2_000_000; // Offset from Firestore counter (1M) to avoid collision

function timestampToTimeString(epoch: number): string {
  const d = new Date(epoch);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function mapProxyMessageToMessage(
  msg: ProxyMessage,
  guestContactId?: string,
): Message {
  const tsMs = msg.channel_timestamp
    ? new Date(msg.channel_timestamp).getTime()
    : new Date(msg.received_at).getTime();

  // Determine sender from direction
  let sender: Message['sender'];
  if (msg.direction === 'inbound') {
    sender = 'guest';
  } else {
    // Outbound: check if it was a bot reply or human agent
    if (msg.sender_id?.startsWith('bot:')) {
      sender = 'bot';
    } else {
      sender = 'agent';
    }
  }

  return {
    id: _proxyMessageIdCounter++,
    sender,
    text: msg.text_body || '',
    time: timestampToTimeString(tsMs),
    createdAt: tsMs,
    senderName: msg.sender_name ?? undefined,
    subject: msg.subject ?? undefined,
    attachments: msg.attachments?.length ? msg.attachments : undefined,
    deliveryStatus: msg.status === 'failed' ? 'failed' : undefined,
    deliveryError: msg.error_message ?? undefined,
  };
}

/** Reset counter (for tests) */
export function _resetProxyMessageIdCounter() {
  _proxyMessageIdCounter = 2_000_000;
}

/**
 * Map Channel Proxy data (Supabase) to AI BPO types (Ticket, Message).
 * Mirrors the pattern in firestore-mappers.ts but for proxy channels.
 */

import type { Host, Message, Ticket } from '@/app/data/types';
import { channelDisplayName, channelToIcon } from './channel-config';
import { computeSLA, formatSLARelative, type EscalationOverride } from './compute-ticket-state';
import { toMillis } from './time-normalize';
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
  const contactRaw = conversation.contacts;
  const contact = (Array.isArray(contactRaw) ? contactRaw[0] : contactRaw) as {
    display_name: string | null;
    avatar_url: string | null;
    channel_contact_id: string;
  } | null;

  const lastMessageAtMs = toMillis(conversation.last_message_at) || Date.now();

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
    contactEmail: contact?.channel_contact_id || undefined,
    // No Firestore linkage
    firestoreThreadId: undefined,
    firestoreHostId: undefined,
    firestoreGuestUserId: undefined,
  };
}

// ---------------------------------------------------------------------------
// ProxyMessage → Message
// ---------------------------------------------------------------------------

import { isBotSent } from './bot-signatures';
import { validateProxyMessage } from './source-validators';

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
  // Validate at the source boundary — a payload missing id / conversation_id
  // / direction / channel_timestamp throws MappingError and the per-row
  // ErrorBoundary renders <MalformedMessageFallback /> instead of letting
  // bad data poison downstream sort/render/cache logic. We DON'T reassign
  // msg from the validator's narrowed return; the downstream mapper reads
  // fields (like error_message) that aren't in the validated schema yet,
  // and the raw payload remains trustworthy once validation passes.
  validateProxyMessage(msg);
  const tsMs = toMillis(msg.channel_timestamp) || toMillis(msg.received_at);

  // Determine sender from direction
  let sender: Message['sender'];
  if (msg.direction === 'inbound') {
    sender = 'guest';
  } else {
    // Outbound: was this one of ours (AI auto-reply) or a manual agent reply?
    // `sender_id` / `metadata.source` would be authoritative if the channel-proxy
    // backend persisted our hint, but it strips it — so we consult the shared
    // Supabase-backed signature registry. Thread-scoped so the same canned
    // reply sent to two different threads doesn't collide.
    const threadKey = `proxy_${msg.conversation_id}`;
    if (msg.sender_id?.startsWith('bot:')
        || msg.metadata?.source === 'bot'
        || isBotSent(threadKey, msg.text_body || '', tsMs)) {
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
    htmlBody: msg.html_body ?? undefined,
    attachments: msg.attachments?.length ? msg.attachments : undefined,
    deliveryStatus: msg.status === 'failed' ? 'failed' : undefined,
    deliveryError: msg.error_message ?? undefined,
  };
}

/** Reset counter (for tests) */
export function _resetProxyMessageIdCounter() {
  _proxyMessageIdCounter = 2_000_000;
}

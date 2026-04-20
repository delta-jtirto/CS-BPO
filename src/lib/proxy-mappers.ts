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
  const contactRaw = conversation.contacts;
  const contact = (Array.isArray(contactRaw) ? contactRaw[0] : contactRaw) as {
    display_name: string | null;
    avatar_url: string | null;
    channel_contact_id: string;
  } | null;

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

let _proxyMessageIdCounter = 2_000_000; // Offset from Firestore counter (1M) to avoid collision

// Persistent registry of bot-sent message signatures.
// When addBotMessage sends a reply via proxy, it registers the text+timestamp here.
// When the real message arrives via Realtime (always as direction='outbound', sender_id=agent),
// the mapper checks this registry to assign sender='bot' for the violet AI bubble.
// Persisted to localStorage so signatures survive page refresh and HMR.
// The channel-proxy backend currently strips our metadata.source='bot' hint on
// send, so this client-side registry is the only surviving bot marker — without
// localStorage persistence, every prior AI reply reverts to a regular agent
// bubble after reload.
const STORAGE_KEY = 'ar:bot-sigs';
const MAX_SIGS = 200;

const _botSentSignatures: Set<string> = new Set(
  (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } })()
);

function botSig(text: string, tsMinute: number): string {
  return `${text.slice(0, 120)}|${tsMinute}`;
}

function persistSigs() {
  try {
    const arr = [..._botSentSignatures];
    // Keep only most recent entries if over limit
    const trimmed = arr.length > MAX_SIGS ? arr.slice(arr.length - MAX_SIGS) : arr;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* localStorage full or unavailable */ }
}

/** Register a message as bot-sent so Realtime arrivals render as AI Auto-Reply. */
export function markBotSent(text: string, timestamp: number) {
  const minute = Math.floor(timestamp / 60_000);
  _botSentSignatures.add(botSig(text, minute));
  persistSigs();
}

export { isBotSent as isBotSentMessage };

function isBotSent(text: string, tsMs: number): boolean {
  const minute = Math.floor(tsMs / 60_000);
  return _botSentSignatures.has(botSig(text, minute))
    || _botSentSignatures.has(botSig(text, minute - 1))
    || _botSentSignatures.has(botSig(text, minute + 1));
}

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
    // Outbound: check if it was a bot reply or human agent.
    // sender_id prefix 'bot:' = legacy indicator; metadata.source = 'bot'
    // is set by addBotMessage/addMultipleMessages for AI auto-replies.
    if (msg.sender_id?.startsWith('bot:') || msg.metadata?.source === 'bot' || isBotSent(msg.text_body || '', tsMs)) {
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

import type { Host, Message, Ticket } from '@/app/data/types';
import { computeSLA, formatSLARelative, type EscalationOverride } from './compute-ticket-state';
import { isBotSent } from './bot-signatures';

// ---------------------------------------------------------------------------
// Firestore types (matching Unified Inbox's data model)
// ---------------------------------------------------------------------------

export interface FirestoreThreadListItem {
  thread_id: string;
  guest_unibox_user_id: string;
  guest_name: string;
  guest_avatar_url: string;
  host_unibox_user_id: string;
  host_name: string;
  host_avatar_url: string;
  host_role: string;
  assignee: { unibox_user_id: string; name: string; role: string }[];
  last_message_preview: string;
  last_message_at: number;
  last_message_sender_id: string;
  created_at: number;
  updated_at: number;
  channel: string;
  is_favourite: boolean;
  is_archived: boolean;
  unread_count: number;
  booking_id: number;
  booking_status?: string;
}

/** V1 Thread document from the `threads` collection (used by Unified Inbox legacy path) */
export interface FirestoreThread {
  thread_id: string;
  guest: { unibox_user_id: string; name: string; avatar_url: string };
  host: { unibox_user_id: string; name: string; avatar_url: string; role: string };
  assignee: { unibox_user_id: string; name: string; role: string }[];
  last_message: { text: string; timestamp: number; unibox_user_id: string };
  created_at: number;
  updated_at: number;
  channel: string;
  is_favourite: boolean;
  is_archived: boolean;
  unread_count: number;
  booking_id: number;
  booking_status?: string;
}

export interface FirestoreMessage {
  message_id: string;
  text: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  timestamp: number;
  status?: string;
  attachments?: { url: string; type: string; path: string }[];
  message_type?: string;
}

// ---------------------------------------------------------------------------
// Channel → Icon mapping (brand-specific)
// ---------------------------------------------------------------------------

// Channel icons and display names unified in channel-config.ts
// Re-exported here for backward compatibility with existing imports
import {
  CHANNEL_ICONS,
  channelToIcon as _channelToIcon,
  channelDisplayName as _channelDisplayName,
} from './channel-config';

export { CHANNEL_ICONS };
export const channelToIcon = _channelToIcon;
export const channelDisplayName = _channelDisplayName;

// ---------------------------------------------------------------------------
// Sender role mapping
// ---------------------------------------------------------------------------

type BPOSender = Message['sender'];

// Keys are lowercase — senderRoleToSender() normalises with .toLowerCase()
// Backend constants (Unified-Inbox-Backend/internal/inbox/constants/constants.go):
//   GuestRole="GUEST", HostRole="HOST", CoHostRole="COHOST", OwnerRole="owner",
//   AdminRole="admin", OperationalManagerRole="operational_manager",
//   RevenueManagerRole="owner_relation", plus operational_staff_* roles
const ROLE_MAP: Record<string, BPOSender> = {
  guest: 'guest',
  host: 'host',
  cohost: 'host',
  owner: 'host',
  staff: 'agent',
  admin: 'agent',
  system: 'system',
  bot: 'bot',
  operational_manager: 'agent',
  owner_relation: 'host',
  operational_staff_booking_staff: 'agent',
  operational_staff_guest_relation: 'agent',
  operational_staff_front_desk: 'agent',
  operational_staff_house_cleaner: 'agent',
  finance_accountant: 'agent',
};

export function senderRoleToSender(role: string): BPOSender {
  return ROLE_MAP[role.toLowerCase()] || 'agent';
}

// ---------------------------------------------------------------------------
// Thread → Ticket mapper
// ---------------------------------------------------------------------------

/** Convert a Firestore thread list item into a BPO Ticket.
 *  SLA/status computed from last_message_at. Tags computed in detail view only. */
export function mapThreadToTicket(
  item: FirestoreThreadListItem,
  hostId: string,
  host: Host,
  companyName: string,
  resolvedAt?: number | null,
  escalationOverride?: EscalationOverride | null,
  handoverReason?: string,
  propertyName?: string,
): Ticket {
  // Firestore timestamps are in seconds — normalize to milliseconds
  const lastMessageAtMs = item.last_message_at > 1e12
    ? item.last_message_at          // already in ms
    : item.last_message_at * 1000;  // convert seconds → ms

  // Compute SLA from last guest message timestamp (consistent across list + detail)
  const slaResult = computeSLA(
    lastMessageAtMs,
    null,
    resolvedAt,
    escalationOverride,
  );
  const status = slaResult.resolved ? 'normal' : slaResult.status === 'stale' ? 'urgent' : slaResult.status;
  const sla = slaResult.resolved ? '' : formatSLARelative(slaResult.sla);

  return {
    id: item.thread_id,
    guestName: item.guest_name || 'Unknown Guest',
    channel: channelDisplayName(item.channel),
    channelIcon: channelToIcon(item.channel),
    host,
    property: propertyName || '', // Resolved from properties list by hostId
    room: '',
    status,
    sla,
    slaSetAt: lastMessageAtMs, // Used for sort — most recent first
    aiHandoverReason: handoverReason || '',
    summary: item.last_message_preview || '',
    tags: [], // Computed in detail view from messages, not from preview
    language: '',
    messages: undefined, // Lazy-loaded from Firestore on ticket click
    // Booking from Firestore
    bookingId: item.booking_id || undefined,
    bookingStatus: item.booking_status || undefined,
    // Firestore linkage
    firestoreThreadId: item.thread_id,
    firestoreHostId: hostId,
    firestoreGuestUserId: item.guest_unibox_user_id,
    // Display metadata
    unreadCount: item.unread_count,
    companyName,
  };
}

// ---------------------------------------------------------------------------
// V1 Thread → Ticket mapper (reads from `threads` collection directly)
// ---------------------------------------------------------------------------

/** Convert a V1 Firestore thread document into a BPO Ticket. */
export function mapV1ThreadToTicket(
  thread: FirestoreThread,
  hostId: string,
  host: Host,
  companyName: string,
  resolvedAt?: number | null,
  escalationOverride?: EscalationOverride | null,
  handoverReason?: string,
  propertyName?: string,
): Ticket {
  const lastMsgTs = thread.last_message?.timestamp ?? 0;
  const lastMessageAtMs = lastMsgTs > 1e12 ? lastMsgTs : lastMsgTs * 1000;

  const slaResult = computeSLA(
    lastMessageAtMs,
    null,
    resolvedAt,
    escalationOverride,
  );
  const status = slaResult.resolved ? 'normal' : slaResult.status === 'stale' ? 'urgent' : slaResult.status;
  const sla = slaResult.resolved ? '' : formatSLARelative(slaResult.sla);

  return {
    id: thread.thread_id,
    guestName: thread.guest?.name || 'Unknown Guest',
    channel: channelDisplayName(thread.channel),
    channelIcon: channelToIcon(thread.channel),
    host,
    property: propertyName || '', // Resolved from properties list by hostId
    room: '',
    status,
    sla,
    slaSetAt: lastMessageAtMs,
    aiHandoverReason: handoverReason || '',
    summary: thread.last_message?.text || '',
    tags: [],
    language: '',
    messages: undefined,
    bookingId: thread.booking_id || undefined,
    bookingStatus: thread.booking_status || undefined,
    firestoreThreadId: thread.thread_id,
    firestoreHostId: hostId,
    firestoreGuestUserId: thread.guest?.unibox_user_id,
    unreadCount: thread.unread_count,
    companyName,
  };
}

// ---------------------------------------------------------------------------
// Firestore Message → BPO Message mapper
// ---------------------------------------------------------------------------

let _messageIdCounter = 1_000_000; // Avoids collision with mock IDs

function timestampToTimeString(epoch: number): string {
  const d = new Date(epoch);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function mapFirestoreMessage(
  msg: FirestoreMessage,
  guestUserId?: string,
  threadKey?: string,
): Message {
  // Normalize: Firestore timestamps may be in seconds
  const tsMs = msg.timestamp > 1e12 ? msg.timestamp : msg.timestamp * 1000;
  // Determine sender: compare sender_id against thread's guest ID (same approach as
  // Unified Inbox's ChatBubble), then fall back to sender_role mapping.  Guest messages
  // from external channels (Airbnb, Booking.com) have empty sender_role/sender_name.
  let sender: Message['sender'];
  if (guestUserId && msg.sender_id === guestUserId) {
    sender = 'guest';
  } else {
    sender = senderRoleToSender(msg.sender_role);
    // Auto-reply messages are sent as the authenticated user (admin/staff role),
    // so sender_role won't be 'bot'. Consult the shared bot-signature registry
    // (Supabase-backed, hydrated on app mount) to re-stamp them as AI Auto-
    // Reply bubbles. Skipped if threadKey is missing — callers that don't yet
    // pass it get the pre-migration behavior (always 'agent' for outbound),
    // which is safe but degrades UI fidelity.
    if (sender === 'agent' && threadKey && isBotSent(threadKey, msg.text || '', tsMs)) {
      sender = 'bot';
    }
  }
  return {
    id: _messageIdCounter++,
    sender,
    text: msg.text || '',
    time: timestampToTimeString(tsMs),
    createdAt: tsMs,
    senderName: msg.sender_name,
    attachments: msg.attachments?.length ? msg.attachments : undefined,
  };
}

/** Reset the message ID counter (for tests) */
export function _resetMessageIdCounter() {
  _messageIdCounter = 1_000_000;
}

import type { LucideIcon } from 'lucide-react';

export interface Host {
  id: string;
  name: string;
  tone: string;
  brandColor: string;
}

export interface Property {
  id: string;
  hostId: string;
  name: string;
  location: string;
  units: number;
  roomNames?: string[];
  status: 'Active' | 'Onboarding';
  lastSyncedAt?: string; // ISO timestamp of last KB sync
  portalToken?: string;  // shareable token for host portal (external/public)
  internalPortalToken?: string;  // internal-only token (staff use)
}

export interface MessageAttachment {
  url: string;
  filename?: string;
  mime_type?: string; // e.g. 'image/jpeg', 'application/pdf'
  type?: string;      // legacy field from Firestore ('image', 'document', etc.)
}

export interface Message {
  id: number;
  sender: 'guest' | 'system' | 'agent' | 'bot' | 'host';
  text: string;
  time: string;
  createdAt: number; // epoch ms — used for cooldown, SLA, time-since calculations
  isGuestMode?: boolean; // true when injected via guest-mode testing — AI should skip
  senderName?: string; // display name from Firestore
  attachments?: MessageAttachment[];
  // Email-specific fields
  subject?: string;
  // Delivery status (proxy channels)
  deliveryStatus?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  deliveryError?: string; // e.g. "Outside 24-hour messaging window"
}

/** @deprecated Use bookingId + bookingStatus on Ticket instead */
export interface Booking {
  checkIn: string;
  checkOut: string;
  guests: number;
  status: string;
}

export interface Ticket {
  id: string;
  guestName: string;
  channel: string;
  channelIcon: LucideIcon;
  host: Host;
  property: string;
  room: string;
  status: 'urgent' | 'warning' | 'normal';
  sla: string;
  slaSetAt?: number; // epoch ms when SLA was last set/escalated
  aiHandoverReason: string;
  summary: string;
  tags: string[];
  language: string;
  messages?: Message[]; // optional — lazy-loaded from Firestore per-thread
  /** @deprecated Use bookingId + bookingStatus instead */
  booking?: Booking;
  bookingId?: number; // from Firestore thread data
  bookingStatus?: string; // from Firestore thread data
  resolvedAt?: number; // epoch ms — set when ticket is resolved
  // Firestore linkage
  firestoreThreadId?: string;
  firestoreHostId?: string; // which Firebase app instance owns this thread
  firestoreGuestUserId?: string; // guest's unibox_user_id — used to identify guest messages
  // Firestore metadata
  unreadCount?: number;
  companyName?: string; // for display in thread list
  // Channel proxy linkage (WhatsApp, Instagram, LINE, Email)
  proxyConversationId?: string;  // Supabase conversation UUID
  proxyCompanyId?: string;       // company_id from channel proxy
  proxyChannel?: string;         // raw channel: 'whatsapp' | 'instagram' | 'line' | 'email'
}

export interface KBEntry {
  id: number;
  hostId: string;
  propId: string | null;
  roomId: string | null;
  scope: 'Host Global' | 'Property' | 'Room';
  title: string;
  content: string;
  tags?: string[];
  internal?: boolean;
  source?: 'onboarding' | 'manual';
  sectionId?: string; // maps back to the form section that generated this entry
}

/** Structured thread status — avoids brittle string prefix parsing (#23) */
export type ThreadStatus = 'ai-handled' | 'handed-off' | 'partial' | 'safety' | null;

/** Parse a system message text into a structured ThreadStatus */
export function parseThreadStatus(text: string): ThreadStatus {
  const t = text.toLowerCase();
  if (t.startsWith('routed to team') || t.startsWith('silently routed')) return 'handed-off';
  if (t.startsWith('follow-up needed')) return 'partial';
  if (t.startsWith('safety alert')) return 'safety';
  // Legacy prefixes (for messages created before the UX overhaul)
  if (t.startsWith('ai handled')) return 'ai-handled';
  if (t.startsWith('handed to agent')) return 'handed-off';
  if (t.startsWith('partially answered')) return 'partial';
  if (t.startsWith('guest safety flag') || t.startsWith('urgent')) return 'safety';
  return null;
}
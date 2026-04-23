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
  htmlBody?: string; // HTML email body for rich rendering
  // Delivery status (proxy channels)
  deliveryStatus?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  deliveryError?: string; // e.g. "Outside 24-hour messaging window"
  /** UUID assigned the moment the composer submits; persisted in
   *  outbound_send_idempotency so duplicate-dispatch attempts (network
   *  retry, React re-render, HMR) are collapsed to a single channel send. */
  clientMessageId?: string;
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
  contactEmail?: string;         // raw channel_contact_id (email address for email channel)
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

// ─── Knowledge Chunks ─────────────────────────────────────────────
//
// Canonical shape for all property knowledge. `KBEntry` above will eventually
// be derived from this; for now it coexists so Phase 0 can land additively
// without touching every consumer.

/** Typed categories of knowledge — drives prompt grouping, UI filters, and
 *  required-coverage checks. Adding a new kind is a forward-compatible change
 *  (unknown kinds are ignored by older clients). */
export type KnowledgeKind =
  | 'property_fact'        // structured fact tied to an onboarding schema slot
  | 'faq'                  // guest Q→A pair
  | 'reply_template'       // canned agent reply
  | 'sop'                  // internal operating procedure
  | 'urgency_rule'         // situation → escalation route
  | 'workflow';            // step-by-step decision tree

export type ChunkSourceType = 'manual' | 'doc_ingest' | 'form' | 'portal';

export type ChunkVisibility = 'internal' | 'guest_facing';

export type ChunkStatus =
  | 'active'               // in use
  | 'archived'             // removed from latest doc, preserved for undo
  | 'pending_review'       // conflict with override / low confidence / missing from re-ingest
  | 'superseded';          // replaced by a newer version of itself

export interface ChunkSource {
  type: ChunkSourceType;
  docId?: string;          // FK → IngestedDocument.id
  docSheet?: string;       // sheet name for xlsx
  docRow?: number;         // row for tabular sources
  /** The RAW string extracted from the source doc, pre-AI-normalization.
   *  Shown next to the normalized body in the KB viewer so agents can verify
   *  the AI didn't paraphrase away a critical nuance. */
  originalText?: string;
  extractedAt?: string;    // ISO
  editedBy?: string;       // user id/email for manual/override chunks
  editReason?: string;     // optional free-text rationale
}

export interface KnowledgeChunk {
  id: string;
  hostId: string;
  propId: string | null;   // null → host-global (applies to all properties)
  roomId: string | null;   // null → property-wide

  kind: KnowledgeKind;

  title: string;           // short label for browse / AI citations
  body: string;            // free text (markdown ok)
  /** Hash of body + structured — stable dedup key within a slot. When a
   *  re-ingest produces an identical chunk we skip the DB write entirely. */
  chunkHash: string;
  /** Escape hatch for kind-specific fields. Kept untyped here; per-kind
   *  validators live next to the kind's consumer. Examples:
   *   faq            → { question, answer, language? }
   *   urgency_rule   → { situation, severity, action, escalateTo }
   *   reply_template → { scenario, template, language, timing? }
   *   property_fact  → { fieldId, sectionId } (from ONBOARDING_SECTIONS)
   *   workflow       → { steps: {title, body, anchor}[] } */
  structured?: Record<string, unknown>;

  /** Deterministic slot identity for `property_fact` only. Built from the
   *  onboarding schema enum so two re-ingests produce the same key for the
   *  same underlying fact. Free-form kinds leave this undefined and use
   *  document-scoped archive-and-replace instead. */
  slotKey?: string;
  /** Override layer — when true, this chunk sits above any doc-ingest chunk
   *  for the same slotKey and wins. Re-ingest NEVER overwrites an override
   *  silently; conflicts surface for user review. */
  isOverride?: boolean;
  /** Chunk id this override replaces (for audit trail and undo). */
  supersedes?: string;

  source: ChunkSource;
  visibility: ChunkVisibility;
  status: ChunkStatus;
  tags?: string[];

  createdAt: string;       // ISO
  updatedAt: string;       // ISO
}

/** Tracks the original docs that chunks were extracted from. One row per
 *  uploaded file; re-ingest of the same file reuses the same id. */
export interface IngestedDocument {
  id: string;
  hostId: string;
  propId: string | null;
  filename: string;
  /** Hash of the full normalized text — if unchanged across two uploads we
   *  skip the expensive AI classification call entirely. */
  contentHash: string;
  uploadedAt: string;
  uploadedBy: string;
  sheets?: string[];       // xlsx sheet names, if applicable
  chunkIds: string[];      // all chunks extracted from this doc
  status: 'processing' | 'ready' | 'partial' | 'failed';
  parseError?: string;
}

/** Default visibility per kind. Internal kinds never leak into guest-facing
 *  AI prompts. Overridable per chunk, but the default protects against
 *  leaking SOPs or escalation matrices into replies sent to guests. */
export function defaultVisibilityForKind(kind: KnowledgeKind): ChunkVisibility {
  switch (kind) {
    case 'faq':
    case 'property_fact':
      return 'guest_facing';
    case 'sop':
    case 'urgency_rule':
    case 'reply_template':
    case 'workflow':
      return 'internal';
  }
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

// ─── Inquiry Resolution Tracking ────────────────────────────
// Per-inquiry handled/active state used by the "What the Guest Needs" panel.
// Keyed by inquiry `type` (the stable dedup key), NOT by `id`.

export type ResolutionSource = 'ai' | 'heuristic' | 'manual';

export interface InquiryResolutionState {
  handled: boolean;
  source: ResolutionSource;
  updatedAt: number;
  /** True when a handled inquiry was pulled back to active by a new guest message */
  reopened?: boolean;
}

/** Map of inquiry type → resolution state */
export type InquiryResolutionMap = Record<string, InquiryResolutionState>;
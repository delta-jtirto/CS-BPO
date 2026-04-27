import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { Ticket, KBEntry, Host, Message, KnowledgeChunk, IngestedDocument } from '../data/types';
import { kvGet, kvSet, stableHash, STORAGE_KEYS } from '../lib/storage';
import * as kbPersist from '@/lib/kb-persistence';
import { MOCK_TICKETS, MOCK_KB, MOCK_HOSTS, MOCK_PROPERTIES } from '../data/mock-data';
import type { Property } from '../data/types';
import { parseThreadStatus } from '../data/types';
import { PREFILLED_ONBOARDING } from '../data/onboarding-prefill';
import { ONBOARDING_SECTIONS as STATIC_SECTIONS } from '../data/onboarding-template';
import type { OnboardingSection, OnboardingField } from '../data/onboarding-template';
import { clearDebugEntries } from '../ai/debug-store';
import type { OperationId, PromptOverride, PromptOverrides } from '../ai/prompts';
import { MessageSquare } from 'lucide-react';
import { detectInquiries } from '../components/inbox/InquiryDetector';
import { useFirestoreConnections, type SavedConnection, type InboxConnection } from '@/hooks/use-firestore-connections';
import { useFirestoreThreads, type FirestoreConnection, type BPOOverlayState } from '@/hooks/use-firestore-threads';
import { type EscalationOverride } from '@/lib/compute-ticket-state';
import { sendGuestMessage } from '@/lib/unibox-send';
import { sendProxyMessage, isProxyChannel } from '@/lib/proxy-send';
import { useProxyConversations } from '@/hooks/use-proxy-conversations';
import { useConversationOverrides } from '@/hooks/use-conversation-overrides';
import { useClassifyCache, type UseClassifyCacheResult } from '@/hooks/use-classify-cache';
import { mapProxyConversationToTicket } from '@/lib/proxy-mappers';
import { edgeFetch } from '@/app/ai/edge-fetch';
import { hydrateBotSignatures, markBotSent } from '@/lib/bot-signatures';
import { supabase as supabaseClient, getUserCompanyIds as fetchProxyCompanyIds, getAccessToken } from '@/lib/supabase-client';
import {
  claimOutboundSend,
  markSendDelivered,
  markSendFailed,
  newClientMessageId,
} from '@/lib/outbound-send-idempotency';
import { toast } from 'sonner';

// Lazy-load the API client so a module-level error in api-client.ts
// cannot crash the entire AppProvider during initialization.
const getApiClient = () => import('../ai/api-client');

export interface Notification {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  type: 'ticket' | 'system';
}

export interface HostSettings {
  hostId: string;
  tone: string;
  autoReply: boolean;
  autoReplyMode: 'auto' | 'draft' | 'assist';  // auto=sends immediately, draft=holds for review, assist=sidebar only
  // Auto-reply behavior settings
  partialCoverage: 'answer-and-escalate' | 'escalate-all';  // Track 3: answer what we can, or escalate everything
  zeroCoverage: 'holding-message' | 'silent-escalate';       // Track 2: send holding msg or just route to agent
  cooldownEnabled: boolean;       // Pause AI after agent reply
  cooldownMinutes: number;        // How long to pause (default 10)
  debouncePreset: 'instant' | 'quick' | 'normal' | 'patient';  // 0s / 10s / 30s / 60s
  safetyKeywords: string[];       // Always-escalate keywords (weapons, threats, etc.)
  /** Active hours — when outside this window the AI sets realistic expectations on response time */
  activeHours: {
    enabled: boolean;
    startHour: number;   // 0–23, local time
    endHour: number;     // 0–23, local time (exclusive)
    displayHours: string; // Human-readable, e.g. "9am–9pm daily"
  };
  demoFeatures: {
    showNotifications: boolean;       // Show Notifications settings tab
    showWorkingHours: boolean;        // Show Working Hours settings tab
    showResponseTimeRules: boolean;   // Show Response Time Rules (SLA) settings tab
    showQuickReplyTemplates: boolean; // Show Quick Reply Templates settings tab
    showTicketDistribution: boolean;  // Show Ticket Distribution settings tab
    showQualityPerformance: boolean;  // Show Quality & Performance settings tab
    showZoomOverride: boolean;        // Show zoom control in TopBar
  };
}

export interface NotificationPrefs {
  emailAlerts: boolean;
  soundAlerts: boolean;
  escalationAlerts: boolean;
  notifyAutoReply: boolean;
  notifyEscalation: boolean;
  notifyDraft: boolean;
}

export interface FormPhase {
  id: number;
  label: string;
  color: string; // tailwind color token e.g. 'red', 'blue', 'green'
}

const DEFAULT_PHASES: FormPhase[] = [
  { id: 1, label: 'Critical', color: 'red' },
  { id: 2, label: 'Guest Experience', color: 'blue' },
];

/**
 * Project a manual-sourced `KnowledgeChunk` back to the legacy `KBEntry`
 * shape so callers of `kbEntries` (KnowledgeBaseView's inline editor,
 * InquiryDetector's legacy consumers) keep working without rewriting.
 *
 * The chunk id convention is `manual-${timestamp}`; we extract the
 * timestamp as the KBEntry's numeric id. For chunks with unexpected ids
 * we hash to a stable positive int so the legacy UI can still key them.
 */
function chunkToKBEntry(c: KnowledgeChunk): KBEntry {
  const legacyIdMatch = c.id.match(/^manual-(\d+)/);
  let numericId: number;
  if (legacyIdMatch) {
    numericId = parseInt(legacyIdMatch[1], 10);
  } else {
    // Deterministic string→int fold; same chunk id always maps to same legacy id.
    let h = 0;
    for (let i = 0; i < c.id.length; i++) {
      h = ((h * 31) + c.id.charCodeAt(i)) | 0;
    }
    numericId = Math.abs(h) || 1;
  }
  return {
    id: numericId,
    hostId: c.hostId,
    propId: c.propId,
    roomId: c.roomId,
    scope: c.roomId ? 'Room' : c.propId ? 'Property' : 'Host Global',
    title: c.title,
    content: c.body,
    tags: c.tags,
    internal: c.visibility === 'internal',
    source: 'manual',
    sectionId: typeof c.structured?.sectionId === 'string' ? c.structured.sectionId : undefined,
  };
}

/**
 * Parse a form-data key into its structured parts so we can derive the
 * deterministic `property_fact` slotKey that `knowledge_chunks` expects.
 *
 * Shapes supported:
 *   "basics__address"           → non-perRoom field
 *   "wifi__room0__networkName"  → perRoom field
 *
 * Returns null for keys that don't match a known schema field (e.g.
 * `faqs__items`, `_meta__filledBy`, stale keys after a FormBuilder edit).
 */
function parseFormKey(
  key: string,
  formTemplate: OnboardingSection[],
  roomNames: string[],
): null | {
  sectionId: string;
  sectionTitle: string;
  fieldId: string;
  fieldLabel: string;
  roomId: string | null;
  roomName: string | undefined;
  slotKey: string;
  hostHidden: boolean;
} {
  const parts = key.split('__');
  if (parts.length < 2 || parts.length > 3) return null;

  const sectionId = parts[0];
  const isRoomScoped = parts.length === 3 && parts[1].startsWith('room');
  const fieldId = isRoomScoped ? parts[2] : parts[1];
  const roomIdx = isRoomScoped ? parseInt(parts[1].slice(4), 10) : -1;

  const section = formTemplate.find(s => s.id === sectionId);
  if (!section) return null;
  if (section.id === 'faqs') return null;
  const field = section.fields.find(f => f.id === fieldId);
  if (!field) return null;

  // Guard: if the schema says perRoom, the key MUST be room-scoped — and
  // vice versa. Mismatch = stale key from a schema change; skip silently.
  if (section.perRoom && !isRoomScoped) return null;
  if (!section.perRoom && isRoomScoped) return null;

  const roomName = isRoomScoped && roomIdx >= 0 && roomIdx < roomNames.length
    ? roomNames[roomIdx]
    : undefined;

  const roomId = isRoomScoped ? `room${roomIdx}` : null;
  const slotKey = `property_fact:${sectionId}:${fieldId}${roomId ? `:${roomId}` : ''}`;

  return {
    sectionId,
    sectionTitle: section.title,
    fieldId,
    fieldLabel: field.label,
    roomId,
    roomName,
    slotKey,
    hostHidden: section.hostHidden === true || field.hostHidden === true,
  };
}

interface AppState {
  // Global filter
  activeHostFilter: string;
  setActiveHostFilter: (v: string) => void;

  // Tickets
  tickets: Ticket[];
  setTickets: React.Dispatch<React.SetStateAction<Ticket[]>>;
  // Lazy-loaded messages for the active thread (from Firestore)
  activeMessages: Message[];
  setActiveMessages: React.Dispatch<React.SetStateAction<Message[]>>;

  // Loading: true until both Firestore AND proxy have returned initial data
  isInitialLoad: boolean;

  // Channel proxy (Supabase-backed channels: WhatsApp, Instagram, LINE, Email)
  proxyCompanyIds: string[];
  setProxyTicketProperty: (ticketId: string, property: string) => void;

  // Firestore connections
  firestoreConnections: import('@/hooks/use-firestore-connections').InboxConnection[];
  firestoreInitializing: boolean;
  addFirestoreConnection: (accessToken: string, host: Host) => Promise<void>;
  removeFirestoreConnection: (hostId: string) => Promise<void>;
  reconnectFirestore: (hostId: string, newToken: string) => Promise<void>;
  /** Mark an inbox connection as expired — surfaces the Reconnect UI.
   *  Call when a downstream API returns 401/403 or Firestore snapshot errors
   *  with permission-denied / unauthenticated. */
  markFirestoreConnectionExpired: (hostId: string) => void;
  /** Synchronous read of the in-memory access token for a host, hydrated
   *  from Supabase KV on boot. Returns null if no connection is active.
   *  Never touches localStorage — tokens are stored server-side only. */
  getFirestoreToken: (hostId: string) => string | null;

  /** Persisted classify-inquiry cache. Consumers call getIfFresh(threadKey,
   *  signature) before running the LLM, and save(...) after a successful
   *  classification. See use-classify-cache.ts for signature semantics. */
  classifyCache: UseClassifyCacheResult;

  // BPO overlay state (persisted in Supabase KV)
  escalationOverrides: Record<string, import('@/lib/compute-ticket-state').EscalationOverride>;
  handoverReasons: Record<string, { reason: string; writtenAt: number }>;
  setHandoverReason: (threadId: string, reason: string) => void;

  resolveTicket: (id: string) => void;
  addMessageToTicket: (ticketId: string, text: string) => void;
  /** Optimistic send state for proxy-channel messages (per ticket). */
  pendingProxyMessages: Record<string, Message[]>;
  /** Re-send a pending message that previously failed. */
  retryPendingProxyMessage: (ticketId: string, localMessageId: number) => void;
  /** Remove a pending message (typically after a failure when the user gives up). */
  deletePendingProxyMessage: (ticketId: string, localMessageId: number) => void;
  injectGuestMessage: (ticketId: string, text: string, isGuestMode?: boolean) => void;
  addBotMessage: (ticketId: string, text: string) => void;
  addSystemMessage: (ticketId: string, text: string) => void;
  addMultipleMessages: (ticketId: string, messages: { sender: Message['sender']; text: string }[]) => void;
  escalateTicketStatus: (ticketId: string) => void;
  escalateTicketWithUrgency: (ticketId: string, level: 'warning' | 'urgent', sla: string) => void;
  deescalateTicket: (ticketId: string) => void;
  deleteMessageFromTicket: (ticketId: string, messageId: number) => void;
  deleteThread: (ticketId: string) => void;

  // Auto-reply processing state (for UI loading indicators)
  autoReplyProcessing: Record<string, boolean>;
  setAutoReplyProcessing: (ticketId: string, processing: boolean) => void;
  autoReplyCancelledRef: React.MutableRefObject<Record<string, boolean>>;
  /** Registry of AbortControllers per ticket — used to cancel in-flight AI HTTP requests */
  autoReplyAbortControllers: React.MutableRefObject<Record<string, AbortController>>;
  cancelAutoReply: (ticketId: string) => void;
  /** Set of ticket IDs that just received their first Firestore message sync.
   *  Auto-reply reads and clears entries to re-initialize its count tracker,
   *  preventing historical Firestore messages from triggering false auto-replies. */
  firestoreSyncedTickets: React.MutableRefObject<Set<string>>;
  autoReplyPausedTickets: Record<string, boolean>;
  toggleAutoReplyPause: (ticketId: string) => void;
  /** Explicitly enable or disable AI for a single ticket, overriding host-level setting. */
  setTicketAiEnabled: (ticketId: string, enabled: boolean) => void;
  autoReplyHandedOff: Record<string, boolean>;
  setAutoReplyHandedOff: (ticketId: string, handedOff: boolean) => void;
  resumeAllAI: () => void;
  threadAiLocks: Record<string, boolean>;
  toggleThreadAiLock: (ticketId: string) => void;

  // Draft replies (for draft auto-reply mode)
  draftReplies: Record<string, string>;
  setDraftReply: (ticketId: string, text: string) => void;
  clearDraftReply: (ticketId: string) => void;

  // Incident log notes per ticket (BPO Step 5 — remarks field)
  ticketNotes: Record<string, string>;
  updateTicketNotes: (ticketId: string, notes: string) => void;

  // KB
  kbEntries: KBEntry[];
  addKBEntry: (entry: Omit<KBEntry, 'id'>) => void;
  updateKBEntry: (id: number, updates: Partial<KBEntry>) => void;
  deleteKBEntry: (id: number) => void;
  deleteKBEntriesBySource: (propId: string, source: 'onboarding' | 'manual') => void;

  // Knowledge Chunks (new typed store — populated by Phase 1 ingest pipeline;
  // empty during Phase 0, but the plumbing is in place so downstream AI
  // context already consumes chunks from both legacy state and this store).
  knowledgeChunks: KnowledgeChunk[];
  upsertKnowledgeChunks: (chunks: KnowledgeChunk[]) => void;
  updateKnowledgeChunk: (id: string, updates: Partial<KnowledgeChunk>) => void;
  deleteKnowledgeChunks: (ids: string[]) => void;

  // Ingested documents — tracks raw uploads so re-ingest is idempotent.
  ingestedDocuments: IngestedDocument[];
  upsertIngestedDocument: (doc: IngestedDocument) => void;
  deleteIngestedDocument: (id: string) => void;

  // Properties (mutable for status updates)
  properties: Property[];
  addProperty: (prop: Property) => void;
  updatePropertyStatus: (id: string, status: Property['status']) => void;
  updatePropertyMeta: (id: string, updates: Partial<Property>) => void;
  deleteProperty: (id: string) => void;

  // Onboarding form data: { [propertyId]: { [sectionId__fieldId]: value } }
  onboardingData: Record<string, Record<string, string>>;
  setOnboardingField: (propertyId: string, key: string, value: string) => Promise<void>;
  setOnboardingBulk: (propertyId: string, data: Record<string, string>) => Promise<void>;
  formPersistStatus: 'local' | 'server' | 'syncing';
  manualSyncFormData: () => Promise<void>;

  // Custom form sections per property
  customFormSections: Record<string, { id: string; title: string }[]>;
  addCustomFormSection: (propertyId: string, title: string) => string;
  removeCustomFormSection: (propertyId: string, sectionId: string) => void;
  renameCustomFormSection: (propertyId: string, sectionId: string, title: string) => void;

  // Notifications
  notifications: Notification[];
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  unreadCount: number;

  // Host settings
  hostSettings: HostSettings[];
  updateHostSettings: (hostId: string, updates: Partial<HostSettings>) => void;

  // Notification preferences
  notificationPrefs: NotificationPrefs;
  updateNotificationPrefs: (updates: Partial<NotificationPrefs>) => void;

  // Prompt overrides
  promptOverrides: PromptOverrides;
  updatePromptOverride: (op: OperationId, field: keyof PromptOverride, value: string | number | undefined) => void;
  resetPromptOverride: (op: OperationId, field?: keyof PromptOverride) => void;

  // Agent presence — drives when AI auto-actions fire
  // 'online': AI assists in sidebar only (classify + suggest), no auto-send
  // 'away': AI auto-replies / drafts per autoReplyMode setting
  agentPresence: 'online' | 'away';
  setAgentPresence: (presence: 'online' | 'away') => void;
  /** Minutes of inactivity before auto-away triggers (0 = disabled) */
  autoAwayMinutes: number;
  setAutoAwayMinutes: (minutes: number) => void;
  /** Global AI kill-switch. When true, useAutoReply bails before claiming
   *  so zero LLM calls, zero outbound sends, zero attempt rows. Use for
   *  emergency triage when a provider misbehaves or a prompt regresses.
   *  Per-agent — a flip on one agent's device does not affect others. */
  aiKillSwitchEnabled: boolean;
  setAiKillSwitchEnabled: (enabled: boolean) => void;

  // Agent preferences
  darkMode: boolean;
  setDarkMode: (v: boolean) => void;
  devMode: boolean;
  setDevMode: (v: boolean) => void;
  agentName: string;
  setAgentName: (v: string) => void;
  defaultLanguage: string;
  setDefaultLanguage: (v: string) => void;

  // AI / OpenRouter
  openRouterApiKey: string;
  setOpenRouterApiKey: (v: string) => void;
  aiModel: string;
  setAiModel: (v: string) => void;
  importAiModel: string;
  setImportAiModel: (v: string) => void;
  hasApiKey: boolean;
  maskedApiKey: string;
  aiSettingsLoading: boolean;
  saveAIApiKey: (key: string) => Promise<void>;
  saveAIModel: (model: string) => Promise<void>;
  saveImportAiModel: (model: string) => Promise<void>;
  clearAIApiKey: () => Promise<void>;
  refreshAISettings: () => Promise<void>;

  // Form template (mutable copy of onboarding sections)
  formTemplate: OnboardingSection[];
  updateFormSection: (sectionId: string, updates: Partial<OnboardingSection>) => void;
  addFormSection: (section: OnboardingSection) => void;
  removeFormSection: (sectionId: string) => void;
  reorderFormSections: (fromIndex: number, toIndex: number) => void;
  updateFormField: (sectionId: string, fieldId: string, updates: Partial<OnboardingField>) => void;
  addFormField: (sectionId: string, field: OnboardingField) => void;
  removeFormField: (sectionId: string, fieldId: string) => void;
  reorderFormFields: (sectionId: string, fromIndex: number, toIndex: number) => void;
  resetFormTemplate: () => void;

  // Form phases
  formPhases: FormPhase[];
  addFormPhase: (phase: FormPhase) => void;
  updateFormPhase: (id: number, updates: Partial<Omit<FormPhase, 'id'>>) => void;
  removeFormPhase: (id: number) => void;
  reorderFormPhases: (fromIndex: number, toIndex: number) => void;
  resetFormPhases: () => void;

  // Reset everything to original demo state
  resetToDemo: () => void;

  // Create a fresh test ticket
  createTestTicket: (opts: { hostId: string; propertyName: string; guestName: string; firstMessage: string }) => string;
}

const AppContext = createContext<AppState | null>(null);

const DEFAULT_SAFETY_KEYWORDS = [
  'weapon', 'gun', 'knife', 'firearm', 'drugs', 'narcotics',
  'suicide', 'self-harm', 'threat', 'assault', 'violence',
  'fire', 'flood', 'gas leak', 'carbon monoxide',
  'medical emergency', 'ambulance', 'police', 'intruder', 'break-in',
];

function makeDefaultHostSettings(h: Host): HostSettings {
  return {
    hostId: h.id, tone: h.tone, autoReply: false,
    autoReplyMode: 'auto' as const,
    partialCoverage: 'answer-and-escalate',
    zeroCoverage: 'holding-message',
    cooldownEnabled: false,
    cooldownMinutes: 10,
    debouncePreset: 'instant',
    safetyKeywords: [...DEFAULT_SAFETY_KEYWORDS],
    activeHours: { enabled: false, startHour: 9, endHour: 21, displayHours: '9am–9pm daily' },
    demoFeatures: {
      showNotifications: false,
      showWorkingHours: false,
      showResponseTimeRules: false,
      showQuickReplyTemplates: false,
      showTicketDistribution: false,
      showQualityPerformance: false,
      showZoomOverride: false,
    },
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [activeHostFilter, setActiveHostFilter] = useState('all');
  // Start empty — Firestore threads merge in once connections authenticate.
  // MOCK_TICKETS only loaded when devMode is explicitly enabled.
  const [tickets, setTickets] = useState<Ticket[]>([]);
  // Legacy `kbEntries` is now a DERIVED view over `knowledgeChunks`.
  // The mutators (addKBEntry/updateKBEntry/deleteKBEntry) write to the
  // chunk store so there's a single source of truth. MOCK_KB is kept as
  // a seed pool that's merged in when the chunk store is empty for demos —
  // writing to a MOCK seed entry no-ops because its id has no backing chunk.
  const [mockKbSeed] = useState<KBEntry[]>(MOCK_KB);
  // Typed knowledge chunks — Phase 1+ ingest pipeline writes here. Empty in
  // Phase 0; buildPropertyContext still derives chunks from legacy state.
  const [knowledgeChunks, setKnowledgeChunks] = useState<KnowledgeChunk[]>([]);
  const [ingestedDocuments, setIngestedDocuments] = useState<IngestedDocument[]>([]);
  // Latest-value refs so async effects (Supabase hydrate) can snapshot
  // current state without capturing stale closures.
  const knowledgeChunksRef = useRef(knowledgeChunks);
  const ingestedDocumentsRef = useRef(ingestedDocuments);
  useEffect(() => { knowledgeChunksRef.current = knowledgeChunks; }, [knowledgeChunks]);
  useEffect(() => { ingestedDocumentsRef.current = ingestedDocuments; }, [ingestedDocuments]);

  // Derived kbEntries — projection of manual-sourced active chunks into
  // the legacy `KBEntry` shape, merged with MOCK_KB seeds for demos.
  // This kills the old setKbEntries state path; writes now flow through
  // addKBEntry/updateKBEntry/deleteKBEntry → knowledgeChunks.
  const kbEntries = useMemo<KBEntry[]>(() => {
    const manualChunks = knowledgeChunks
      .filter(c => c.source.type === 'manual' && c.status === 'active')
      .map(chunkToKBEntry);
    // Dedupe: a MOCK seed and a user-created chunk could collide on id
    // (unlikely — seed ids are small ints, chunks use Date.now()-ish).
    const byId = new Map<number, KBEntry>();
    for (const e of mockKbSeed) byId.set(e.id, e);
    for (const e of manualChunks) byId.set(e.id, e);
    return Array.from(byId.values());
  }, [knowledgeChunks, mockKbSeed]);
  // Messages for the currently active thread — lazy-loaded from Firestore
  const [activeMessages, setActiveMessages] = useState<Message[]>([]);
  // Tracks which tickets just received their first Firestore message sync
  // so useAutoReply can re-initialize its count without false-triggering
  const firestoreSyncedTickets = useRef<Set<string>>(new Set());

  // Optimistic pending messages for proxy channels (WhatsApp, Instagram, LINE, Email).
  // Keyed by ticket id. Each entry is a Message with deliveryStatus='sending'|'sent'|'failed'.
  // When the real message arrives via Supabase Realtime, the pending copy is removed
  // by a dedup effect in InboxView.
  const [pendingProxyMessages, setPendingProxyMessages] = useState<Record<string, Message[]>>({});

  // ─── Firestore connections ────────────────────────────────
  // Load saved connections from Supabase KV on mount
  const [initialSavedConnections, setInitialSavedConnections] = useState<SavedConnection[]>([]);
  const inboxesLoadedRef = useRef(false);

  useEffect(() => {
    if (inboxesLoadedRef.current) return;
    inboxesLoadedRef.current = true;
    (async () => {
      try {
        const api = await getApiClient();
        const inboxes = await api.getInboxes();
        if (inboxes.length === 0) return;
        const hostIds = inboxes.map(i => i.hostId);
        const tokens = await api.getInboxTokens(hostIds);
        const connections: SavedConnection[] = inboxes
          .map(inbox => ({
            hostId: inbox.hostId,
            companyName: inbox.companyName,
            host: MOCK_HOSTS.find(h => h.id === inbox.hostId) || MOCK_HOSTS[0],
            accessToken: tokens[inbox.hostId] || '',
            maskedToken: inbox.maskedToken || '',
          }))
          .filter(c => c.accessToken);
        if (connections.length > 0) {
          setInitialSavedConnections(connections);
        }
      } catch (err) {
        // Supabase KV is the only token store. If unreachable, we surface
        // the connection as disconnected rather than silently loading a
        // stale localStorage copy. Legacy entries from prior builds are
        // wiped below so they can't leak.
        console.error('Failed to load inboxes from Supabase KV:', err);
        toast.error('Could not load connected inboxes', {
          description: 'Check your connection and reload. Tokens are stored server-side.',
        });
      }

      // One-time cleanup of legacy localStorage token caches written by
      // earlier builds. Safe to run unconditionally — the source of truth
      // is now Supabase KV.
      try {
        localStorage.removeItem('settings_inbox_tokens');
      } catch { /* ignore */ }
    })();
  }, []);

  const handleConnectionHealthChange = useCallback((hostId: string, companyName: string, health: string, message: string) => {
    if (health === 'expired') {
      toast.error(`${companyName}: Token expired`, { description: 'Go to Settings > Connected Inboxes to reconnect.' });
    } else if (health === 'network-error') {
      toast.error(`${companyName}: Connection lost`, { description: message });
    }
  }, []);

  const {
    connections: firestoreConnections,
    isInitializing: firestoreInitializing,
    addConnection: addFirestoreConnection,
    removeConnection: removeFirestoreConnection,
    reconnect: reconnectFirestore,
    markExpired: markFirestoreConnectionExpired,
    getTokenForHost: getFirestoreToken,
  } = useFirestoreConnections(
    initialSavedConnections,
    handleConnectionHealthChange,
  );

  // Build FirestoreConnection array from healthy connections for the thread list hook
  // Memoize to prevent useFirestoreThreads from re-subscribing on every render
  const healthyConnections: FirestoreConnection[] = React.useMemo(() =>
    firestoreConnections
      .filter(c => c.status === 'connected' && c.userId && c.db)
      .map(c => ({
        hostId: c.hostId,
        userId: c.userId!,
        db: c.db!,
        companyName: c.companyName,
        host: c.host,
      })),
    // Re-compute only when connection count or statuses change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [firestoreConnections.map(c => `${c.hostId}:${c.status}`).join(',')],
  );

  // ─── Properties (must be before useFirestoreThreads which references it) ───
  const [properties, setProperties] = useState<Property[]>(MOCK_PROPERTIES);

  // ─── BPO overlay state (persisted in Supabase KV) ──────────
  const [escalationOverrides, setEscalationOverrides] = useState<Record<string, EscalationOverride>>(() => {
    try { return JSON.parse(localStorage.getItem('bpo_escalations') || '{}'); } catch { return {}; }
  });
  const [handoverReasons, setHandoverReasons] = useState<Record<string, { reason: string; writtenAt: number }>>(() => {
    try { return JSON.parse(localStorage.getItem('bpo_handover_reasons') || '{}'); } catch { return {}; }
  });

  // Persist BPO overlay to localStorage when it changes
  // (Supabase KV sync happens via the existing preferences save path on mount)
  useEffect(() => {
    try { localStorage.setItem('bpo_escalations', JSON.stringify(escalationOverrides)); } catch {}
  }, [escalationOverrides]);

  useEffect(() => {
    try { localStorage.setItem('bpo_handover_reasons', JSON.stringify(handoverReasons)); } catch {}
  }, [handoverReasons]);

  const setHandoverReason = useCallback((threadId: string, reason: string) => {
    setHandoverReasons(prev => ({ ...prev, [threadId]: { reason, writtenAt: Date.now() } }));
  }, []);

  const bpoOverlayState: BPOOverlayState = React.useMemo(() => ({
    escalationOverrides,
    resolvedIds: {}, // TODO: wire resolvedIds with timestamps when refactoring resolve flow
    handoverReasons: Object.fromEntries(
      Object.entries(handoverReasons).map(([k, v]) => [k, v.reason]),
    ),
  }), [escalationOverrides, handoverReasons]);

  // Subscribe to thread lists from all healthy connections
  const { threads: firestoreThreads, isLoading: firestoreThreadsLoading } = useFirestoreThreads(
    healthyConnections,
    null,
    bpoOverlayState,
    properties,
    markFirestoreConnectionExpired,
  );

  // Merge Firestore threads into the tickets state
  useEffect(() => {
    if (firestoreThreads.length === 0) return;
    setTickets(prev => {
      const nonFirestore = prev.filter(t => !t.firestoreThreadId);
      const merged = [...nonFirestore, ...firestoreThreads];
      const deduped = Array.from(new Map(merged.map(t => [t.id, t])).values());
      // Sort: Firestore threads by last_message_at (newest first), mock tickets keep relative order
      deduped.sort((a, b) => {
        // Both have slaSetAt or createdAt — use most recent activity
        const aTime = a.slaSetAt || (a.messages?.[a.messages.length - 1]?.createdAt) || 0;
        const bTime = b.slaSetAt || (b.messages?.[b.messages.length - 1]?.createdAt) || 0;
        return bTime - aTime; // newest first
      });
      return deduped;
    });
  }, [firestoreThreads]);

  // ─── Channel Proxy (Supabase): WhatsApp, Instagram, LINE, Email ───
  const [proxyCompanyIds, setProxyCompanyIds] = useState<string[]>([]);

  // Load proxy company IDs on mount
  useEffect(() => {
    fetchProxyCompanyIds().then(ids => setProxyCompanyIds(ids)).catch(() => {});
  }, []);

  // Subscribe to proxy conversations via Supabase Realtime
  const { conversations: proxyConversations, isLoading: proxyConversationsLoading } = useProxyConversations({
    supabase: supabaseClient,
    companyIds: proxyCompanyIds,
    pageSize: 50,
  });

  // ─── Agent-side overrides on proxy conversations (Supabase-backed) ───
  // Persists to public.conversation_overrides — shared across devices/agents,
  // survives localStorage clears, and scoped by RLS to the user's company.
  const { overrides: conversationOverrides, setOverride: setConversationOverride } = useConversationOverrides({
    supabase: supabaseClient,
    companyIds: proxyCompanyIds,
  });

  // ─── Persisted classify-inquiry cache (Supabase-backed) ──────────────
  // Stores LLM classification results keyed by ticket.id + (lastMessageId,
  // messageCount, modelVersion) signature. AssistantPanel short-circuits the
  // LLM call when the signature matches, saving tokens across reloads too.
  const classifyCache = useClassifyCache({
    supabase: supabaseClient,
    companyIds: proxyCompanyIds,
  });

  // ─── Persisted bot-reply marker registry (Supabase-backed) ───────────
  // Hydrates the in-memory signature Set so proxy/Firestore mappers can
  // correctly classify round-tripped AI auto-replies as sender='bot' after
  // refresh and across devices. Fires once per unique companyIds set.
  useEffect(() => {
    if (proxyCompanyIds.length === 0) return;
    void hydrateBotSignatures(supabaseClient, proxyCompanyIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proxyCompanyIds.join(',')]);

  // Public API: unchanged callsite shape — ticketId is the `proxy_<uuid>` id,
  // we strip the prefix before persisting and look up company_id from the
  // current tickets array so callers don't have to thread it through.
  const setProxyTicketProperty = useCallback((ticketId: string, property: string) => {
    const ticket = tickets.find(t => t.id === ticketId);
    const conversationId = ticket?.proxyConversationId;
    const companyId = ticket?.proxyCompanyId;
    if (!conversationId || !companyId) {
      console.warn('[setProxyTicketProperty] missing proxy linkage on ticket', ticketId);
      return;
    }
    // Fire-and-forget — the hook updates local state optimistically so the
    // UI reflects the change before the network round-trip completes.
    void setConversationOverride(conversationId, companyId, 'property', property);
  }, [tickets, setConversationOverride]);

  // Merge proxy conversations into the tickets state
  // Fetch channel accounts from proxy API to get host_id mappings
  const [proxyAccountHostMap, setProxyAccountHostMap] = useState<Record<string, string>>({});
  const [proxyAccountRefreshTick, setProxyAccountRefreshTick] = useState(0);
  const refreshProxyAccounts = useCallback(() => setProxyAccountRefreshTick(t => t + 1), []);

  useEffect(() => {
    if (proxyCompanyIds.length === 0) return;
    (async () => {
      try {
        const token = await getAccessToken();
        const PROXY_URL = import.meta.env.VITE_CHANNEL_PROXY_URL || '';
        if (!token || !PROXY_URL) return;
        const res = await fetch(`${PROXY_URL}/api/proxy/accounts?company_id=${proxyCompanyIds[0]}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const map: Record<string, string> = {};
          for (const acct of data.accounts || []) {
            if (acct.host_id) {
              map[acct.id] = acct.host_id;
              // Also key by company_id + channel for conversation lookup
              map[`${acct.company_id}_${acct.channel}`] = acct.host_id;
            }
          }
          setProxyAccountHostMap(map);
        }
      } catch {}
    })();
  }, [proxyCompanyIds, proxyAccountRefreshTick]);

  // Listen for host mapping changes from Settings (via custom event)
  useEffect(() => {
    const handler = () => refreshProxyAccounts();
    window.addEventListener('channel-host-updated', handler);
    return () => window.removeEventListener('channel-host-updated', handler);
  }, [refreshProxyAccounts]);

  useEffect(() => {
    if (proxyConversations.length === 0 && !proxyConversationsLoading) return;
    const defaultHost = MOCK_HOSTS[0] || { id: 'default', name: 'Default', tone: '', brandColor: '#6366f1' };

    const freshProxyTickets = proxyConversations.map(c => {
      // Look up host by company_id + channel (1 account per channel per company)
      const channelKey = `${c.company_id}_${c.channel}`;
      const hostId = proxyAccountHostMap[channelKey];
      const host = hostId ? (MOCK_HOSTS.find(h => h.id === hostId) || defaultHost) : defaultHost;
      return mapProxyConversationToTicket(c, host, host.name);
    });
    setTickets(prev => {
      const nonProxy = prev.filter(t => !t.proxyConversationId);
      // Apply Supabase-persisted overrides (e.g. manually-picked property) on
      // top of fresh channel data. Keyed by the raw conversation_id (uuid),
      // not the prefixed ticket.id — conversation_overrides.conversation_id
      // is the uuid from public.conversations.
      const proxyTickets = freshProxyTickets.map(newT => {
        const override = newT.proxyConversationId
          ? conversationOverrides[newT.proxyConversationId]
          : undefined;
        // Only spread fields that are actually set — a null from Supabase
        // shouldn't clobber a real value from the mapper.
        const patched = { ...newT };
        if (override?.property) patched.property = override.property;
        return patched;
      });
      const merged = [...nonProxy, ...proxyTickets];
      const deduped = Array.from(new Map(merged.map(t => [t.id, t])).values());
      deduped.sort((a, b) => {
        const aTime = a.slaSetAt || 0;
        const bTime = b.slaSetAt || 0;
        return bTime - aTime;
      });
      return deduped;
    });
  // conversationOverrides must be in deps so picking a property in the UI
  // immediately re-merges into `tickets` — otherwise the override only takes
  // effect on the next proxy poll, and classify-inquiry fires with
  // ticket.property='' and no property KB.
  }, [proxyConversations, proxyConversationsLoading, conversationOverrides, proxyAccountHostMap]);

  // Unified initial load flag (both Firestore and proxy must resolve)
  const isInitialLoad = firestoreThreadsLoading || proxyConversationsLoading;

  const [darkMode, setDarkModeRaw] = useState(false);
  const [devModeRaw, setDevModeRaw] = useState(false);
  const [agentNameRaw, setAgentNameRaw] = useState('');

  // Load display name from Supabase profile on mount
  useEffect(() => {
    supabaseClient.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      supabaseClient
        .from('profiles')
        .select('full_name')
        .eq('id', session.user.id)
        .single()
        .then(({ data }) => {
          if (data?.full_name && !agentNameRaw) {
            setAgentNameRaw(data.full_name);
          }
        });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [defaultLanguageRaw, setDefaultLanguageRaw] = useState('en');

  // ─── Agent presence ───────────────────────────────────────
  // 'online' = AI assists only (no auto-send); 'away' = AI auto-acts per autoReplyMode
  const [agentPresence, setAgentPresenceRaw] = useState<'online' | 'away'>(() => {
    try { return (localStorage.getItem('agentPresence') as 'online' | 'away') || 'online'; } catch { return 'online'; }
  });
  const setAgentPresence = useCallback((presence: 'online' | 'away') => {
    setAgentPresenceRaw(presence);
    try { localStorage.setItem('agentPresence', presence); } catch {}
  }, []);
  // ─── Global AI kill-switch ────────────────────────────────
  // Hard cut-off that suppresses every auto-reply attempt across every
  // host and every ticket. Per-agent (stored in localStorage); during a
  // provider outage / model misbehavior an operator can flip this and
  // stop all outbound AI traffic instantly while triaging.
  const [aiKillSwitchEnabled, setAiKillSwitchRaw] = useState<boolean>(() => {
    try { return localStorage.getItem('aiKillSwitch') === 'true'; } catch { return false; }
  });
  const setAiKillSwitchEnabled = useCallback((enabled: boolean) => {
    setAiKillSwitchRaw(enabled);
    try { localStorage.setItem('aiKillSwitch', String(enabled)); } catch {}
    if (enabled) {
      // Abort every in-flight LLM call so tokens stop burning immediately.
      // The main useAutoReply effect short-circuits on the next tick, but
      // claims already dispatched won't cancel themselves. Mark them
      // cancelled + abort their fetch. Finalize-as-error fires via the
      // catch block in processTicket so loser tabs don't hang on pending.
      const controllers = autoReplyAbortControllers.current;
      const cancelRef = autoReplyCancelledRef.current;
      let aborted = 0;
      for (const ticketId of Object.keys(controllers)) {
        cancelRef[ticketId] = true;
        try { controllers[ticketId].abort(); aborted++; } catch { /* ignore */ }
        delete controllers[ticketId];
      }
      setAutoReplyProcessingState({});
      toast.warning('AI auto-reply disabled globally', {
        description: aborted > 0
          ? `No AI replies will be sent across any ticket. ${aborted} in-flight call${aborted === 1 ? '' : 's'} aborted.`
          : 'No AI replies will be sent across any ticket until re-enabled.',
        duration: 5000,
      });
    }
  }, []);
  const [autoAwayMinutes, setAutoAwayMinutesRaw] = useState<number>(() => {
    try { return parseInt(localStorage.getItem('autoAwayMinutes') || '5', 10) || 5; } catch { return 5; }
  });
  const setAutoAwayMinutes = useCallback((minutes: number) => {
    setAutoAwayMinutesRaw(minutes);
    try { localStorage.setItem('autoAwayMinutes', String(minutes)); } catch {}
  }, []);

  // ─── BE-persisted preferences ────────────────────────────
  // Per-key debounce timers (#20) — prevents race where rapid changes clobber each other
  const prefsSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Debounced save to backend — each key gets its own independent timer
  const syncPrefToBackend = useCallback((key: string, value: any) => {
    if (prefsSaveTimersRef.current[key]) clearTimeout(prefsSaveTimersRef.current[key]);
    prefsSaveTimersRef.current[key] = setTimeout(async () => {
      try {
        const { savePreferences } = await getApiClient();
        await savePreferences({ [key]: value });
      } catch (err) {
        console.error(`Failed to persist preference "${key}" to backend:`, err);
      }
    }, 300);
  }, []);

  const setDevMode = useCallback((v: boolean) => {
    setDevModeRaw(v);
    syncPrefToBackend('devMode', v);
  }, [syncPrefToBackend]);

  const setDarkMode = useCallback((v: boolean) => {
    setDarkModeRaw(v);
    syncPrefToBackend('darkMode', v);
  }, [syncPrefToBackend]);

  const setAgentName = useCallback((v: string) => {
    setAgentNameRaw(v);
    syncPrefToBackend('agentName', v);
    // Also persist to Supabase profiles table
    supabaseClient.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        supabaseClient.from('profiles').update({ full_name: v }).eq('id', session.user.id).then(() => {});
      }
    });
  }, [syncPrefToBackend]);

  const setDefaultLanguage = useCallback((v: string) => {
    setDefaultLanguageRaw(v);
    syncPrefToBackend('defaultLanguage', v);
  }, [syncPrefToBackend]);

  // Load preferences from backend on mount
  const prefsLoadedRef = useRef(false);
  useEffect(() => {
    if (prefsLoadedRef.current) return;
    prefsLoadedRef.current = true;
    (async () => {
      try {
        const { getPreferences } = await getApiClient();
        const prefs = await getPreferences();
        if (typeof prefs.devMode === 'boolean') setDevModeRaw(prefs.devMode);
        if (typeof prefs.darkMode === 'boolean') setDarkModeRaw(prefs.darkMode);
        if (typeof prefs.agentName === 'string' && prefs.agentName) setAgentNameRaw(prefs.agentName);
        if (typeof prefs.defaultLanguage === 'string' && prefs.defaultLanguage) setDefaultLanguageRaw(prefs.defaultLanguage);
        if (Array.isArray(prefs.hostSettings)) setHostSettings(prefs.hostSettings);
        if (prefs.autoReplyPausedTickets && typeof prefs.autoReplyPausedTickets === 'object') {
          setAutoReplyPausedTickets(prev => ({ ...prev, ...prefs.autoReplyPausedTickets }));
        }
        if (prefs.threadAiLocks && typeof prefs.threadAiLocks === 'object') {
          setThreadAiLocks(prev => ({ ...prev, ...prefs.threadAiLocks }));
        }
        if (prefs.notificationPrefs && typeof prefs.notificationPrefs === 'object') {
          setNotificationPrefs(prev => ({ ...prev, ...prefs.notificationPrefs }));
        }
        if (prefs.promptOverrides && typeof prefs.promptOverrides === 'object') {
          setPromptOverridesRaw(prefs.promptOverrides);
          try { localStorage.setItem('promptOverrides', JSON.stringify(prefs.promptOverrides)); } catch {}
        }

        // Load properties from dedicated table
        try {
          const { getProperties } = await getApiClient();
          const props = await getProperties();
          if (Array.isArray(props) && props.length > 0) setProperties(props);
        } catch (err) {
          console.error('Failed to load properties:', err);
        }

        // Load persisted ticket state (messages + resolved IDs)
        // Only restore mock ticket state in devMode — in production mode,
        // tickets come from Firestore connections.
        const isDevMode = typeof prefs.devMode === 'boolean' ? prefs.devMode : devModeRaw;
        if (isDevMode && prefs.ticketState) {
          try {
            const state = typeof prefs.ticketState === 'string'
              ? JSON.parse(prefs.ticketState) : prefs.ticketState;
            const { messages, resolvedIds, customTickets } = state as {
              messages: Record<string, any[]>;
              resolvedIds: string[];
              customTickets?: any[];
            };
            skipNextTicketSaveRef.current = true;
            const restoredMock = MOCK_TICKETS
              .filter(t => !(resolvedIds || []).includes(t.id))
              .map(t => messages?.[t.id]
                ? { ...t, messages: messages[t.id] }
                : t
              );
            const restoredCustom = (customTickets || []).map((ct: any) => ({
              ...ct,
              channelIcon: MessageSquare,
            }));
            setTickets([...restoredCustom, ...restoredMock]);
          } catch (parseErr) {
            console.error('Failed to parse saved ticket state:', parseErr);
          }
        } else if (isDevMode) {
          // devMode but no saved state — load mock data
          setTickets(MOCK_TICKETS);
        }
        // If not devMode, tickets stay empty — Firestore connections will populate them
        ticketsLoadedRef.current = true;
      } catch (err) {
        console.error('Failed to load preferences from backend:', err);
        ticketsLoadedRef.current = true;
      }
    })();
  }, []);

  // Load KB entries from database on app startup (Supabase) or localStorage (dev fallback)
  useEffect(() => {
    const loadKBFromDatabase = async () => {
      // Try localStorage first (fast, reliable)
      const localData = localStorage.getItem('kb_entries_all');
      if (localData) {
        try {
          const entries = JSON.parse(localData);
          if (Array.isArray(entries) && entries.length > 0) {
            // Filter out stale form-derived entries — form data is now used directly for AI context
            const manualOnly = entries.filter((e: { source?: string }) => e.source !== 'onboarding');
            console.log(`[KB Load] Ignoring ${manualOnly.length} stale legacy KB entries from localStorage — kbEntries is now derived from knowledge_chunks.`);
            return;
          }
        } catch {}
      }
      console.log('[KB Load] No persisted data found, using MOCK_KB');
    };
    loadKBFromDatabase();
  }, []);

  const [formPersistStatus, setFormPersistStatus] = useState<'local' | 'server' | 'syncing'>('local');

  const [openRouterApiKey, setOpenRouterApiKeyRaw] = useState(() => {
    try {
      // Try to get from localStorage first
      const cached = localStorage.getItem('openRouterApiKey');
      if (cached) return cached;
      // Try alternate key names for backwards compatibility
      return localStorage.getItem('openrouter_api_key') || '';
    } catch {
      return '';
    }
  });
  const setOpenRouterApiKey = useCallback((v: string) => {
    setOpenRouterApiKeyRaw(v);
    try {
      localStorage.setItem('openRouterApiKey', v);
      localStorage.setItem('openrouter_api_key', v); // Also save with alternate key for compatibility
    } catch {}
  }, []);

  const [aiModel, setAiModelRaw] = useState(() => {
    try { return localStorage.getItem('aiModel') || 'openai/gpt-4o-mini'; } catch { return 'openai/gpt-4o-mini'; }
  });
  const setAiModel = useCallback((v: string) => {
    setAiModelRaw(v);
    try { localStorage.setItem('aiModel', v); } catch {}
  }, []);

  const [importAiModel, setImportAiModelRaw] = useState(() => {
    try { return localStorage.getItem('importAiModel') || 'google/gemini-3.1-flash-lite-preview'; } catch { return 'google/gemini-3.1-flash-lite-preview'; }
  });
  const setImportAiModel = useCallback((v: string) => {
    setImportAiModelRaw(v);
    try { localStorage.setItem('importAiModel', v); } catch {}
  }, []);

  const [notifications, setNotifications] = useState<Notification[]>([
    { id: 'n1', title: 'New Escalation', message: 'Elena Rodriguez - AC issue at Villa Azure escalated by AI', time: '2 min ago', read: false, type: 'ticket' },
    { id: 'n3', title: 'Knowledge Base Updated', message: 'Urban Stays Co. luggage policy was modified by Admin', time: '1 hr ago', read: true, type: 'system' },
  ]);

  const [hostSettings, setHostSettings] = useState<HostSettings[]>(
    MOCK_HOSTS.map(h => makeDefaultHostSettings(h))
  );

  // ─── Notification preferences (persisted to backend) ─────
  const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
    emailAlerts: true, soundAlerts: true, escalationAlerts: true,
    notifyAutoReply: true, notifyEscalation: true, notifyDraft: true,
  };
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const updateNotificationPrefs = useCallback((updates: Partial<NotificationPrefs>) => {
    setNotificationPrefs(prev => {
      const next = { ...prev, ...updates };
      syncPrefToBackend('notificationPrefs', next);
      return next;
    });
  }, [syncPrefToBackend]);

  const [promptOverrides, setPromptOverridesRaw] = useState<PromptOverrides>(() => {
    try { return JSON.parse(localStorage.getItem('promptOverrides') || '{}'); } catch { return {}; }
  });

  const updatePromptOverride = useCallback((op: OperationId, field: keyof PromptOverride, value: string | number | undefined) => {
    // Normalize: empty/whitespace-only strings are treated as "no override"
    const sanitized = (typeof value === 'string' && !value.trim()) ? undefined : value;
    setPromptOverridesRaw(prev => {
      const next: PromptOverrides = { ...prev, [op]: { ...prev[op], [field]: sanitized } };
      if (sanitized === undefined) {
        const opOverride = { ...next[op] };
        delete opOverride[field];
        next[op] = Object.keys(opOverride).length ? opOverride : undefined;
      }
      try { localStorage.setItem('promptOverrides', JSON.stringify(next)); } catch {}
      syncPrefToBackend('promptOverrides', next);
      return next;
    });
  }, [syncPrefToBackend]);

  const resetPromptOverride = useCallback((op: OperationId, field?: keyof PromptOverride) => {
    setPromptOverridesRaw(prev => {
      let next: PromptOverrides;
      if (field) {
        const opOverride = { ...prev[op] };
        delete opOverride[field];
        next = { ...prev, [op]: Object.keys(opOverride).length ? opOverride : undefined };
      } else {
        next = { ...prev };
        delete next[op];
      }
      try { localStorage.setItem('promptOverrides', JSON.stringify(next)); } catch {}
      syncPrefToBackend('promptOverrides', next);
      return next;
    });
  }, [syncPrefToBackend]);

  const [onboardingData, setOnboardingData] = useState<Record<string, Record<string, string>>>(() => {
    try {
      const stored = localStorage.getItem('onboardingData');
      return stored ? JSON.parse(stored) : PREFILLED_ONBOARDING;
    } catch { return PREFILLED_ONBOARDING; }
  });
  const onboardingDataRef = useRef(onboardingData);
  useEffect(() => { onboardingDataRef.current = onboardingData; }, [onboardingData]);
  const [customFormSections, setCustomFormSections] = useState<Record<string, { id: string; title: string }[]>>({});
  // #14: Persist draft replies to localStorage so they survive page refresh
  const [draftReplies, setDraftRepliesState] = useState<Record<string, string>>(() => {
    try { const s = localStorage.getItem('draftReplies'); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });

  // Incident log notes per ticket (BPO Step 5 — remarks field), persisted to localStorage
  const [ticketNotes, setTicketNotesState] = useState<Record<string, string>>(() => {
    try { const s = localStorage.getItem('ticketNotes'); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const updateTicketNotes = useCallback((ticketId: string, notes: string) => {
    setTicketNotesState(prev => {
      const next = { ...prev, [ticketId]: notes };
      try { localStorage.setItem('ticketNotes', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // ─── Auto-reply processing / cancellation / pause state ───────
  const [autoReplyProcessing, setAutoReplyProcessingState] = useState<Record<string, boolean>>({});
  const autoReplyCancelledRef = useRef<Record<string, boolean>>({});
  const autoReplyAbortControllers = useRef<Record<string, AbortController>>({});
  const [autoReplyPausedTickets, setAutoReplyPausedTickets] = useState<Record<string, boolean>>(() => {
    try { const s = localStorage.getItem('autoReplyPausedTickets'); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const [autoReplyHandedOff, setAutoReplyHandedOffState] = useState<Record<string, boolean>>(() => {
    try { const s = localStorage.getItem('autoReplyHandedOff'); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const [threadAiLocks, setThreadAiLocks] = useState<Record<string, boolean>>(() => {
    try { const s = localStorage.getItem('threadAiLocks'); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });

  const setAutoReplyProcessing = useCallback((ticketId: string, processing: boolean) => {
    setAutoReplyProcessingState(prev => ({ ...prev, [ticketId]: processing }));
  }, []);

  const cancelAutoReply = useCallback((ticketId: string) => {
    autoReplyCancelledRef.current[ticketId] = true;
    setAutoReplyProcessingState(prev => ({ ...prev, [ticketId]: false }));
    const abortController = autoReplyAbortControllers.current[ticketId];
    if (abortController) {
      abortController.abort();
      delete autoReplyAbortControllers.current[ticketId];
    }
  }, []);

  const toggleAutoReplyPause = useCallback((ticketId: string) => {
    setAutoReplyPausedTickets(prev => {
      const next = { ...prev, [ticketId]: !prev[ticketId] };
      syncPrefToBackend('autoReplyPausedTickets', next);
      return next;
    });
  }, [syncPrefToBackend]);

  const setTicketAiEnabled = useCallback((ticketId: string, enabled: boolean) => {
    setAutoReplyPausedTickets(prev => {
      const next = { ...prev, [ticketId]: !enabled };
      syncPrefToBackend('autoReplyPausedTickets', next);
      return next;
    });
  }, [syncPrefToBackend]);

  const setAutoReplyHandedOff = useCallback((ticketId: string, handedOff: boolean) => {
    setAutoReplyHandedOffState(prev => ({ ...prev, [ticketId]: handedOff }));
  }, []);

  const toggleThreadAiLock = useCallback((ticketId: string) => {
    setThreadAiLocks(prev => {
      const next = { ...prev };
      if (next[ticketId]) {
        delete next[ticketId];
      } else {
        next[ticketId] = true;
      }
      syncPrefToBackend('threadAiLocks', next);
      return next;
    });
  }, [syncPrefToBackend]);

  // Persist paused/handed-off/lock state to localStorage
  useEffect(() => {
    try { localStorage.setItem('autoReplyPausedTickets', JSON.stringify(autoReplyPausedTickets)); } catch {}
  }, [autoReplyPausedTickets]);

  useEffect(() => {
    try { localStorage.setItem('autoReplyHandedOff', JSON.stringify(autoReplyHandedOff)); } catch {}
  }, [autoReplyHandedOff]);

  useEffect(() => {
    try { localStorage.setItem('threadAiLocks', JSON.stringify(threadAiLocks)); } catch {}
  }, [threadAiLocks]);

  // #14: Persist drafts to localStorage
  useEffect(() => {
    try { localStorage.setItem('draftReplies', JSON.stringify(draftReplies)); } catch {}
  }, [draftReplies]);

  const setDraftReply = useCallback((ticketId: string, text: string) => {
    setDraftRepliesState(prev => ({ ...prev, [ticketId]: text }));
  }, []);

  const clearDraftReply = useCallback((ticketId: string) => {
    setDraftRepliesState(prev => {
      const next = { ...prev };
      delete next[ticketId];
      return next;
    });
  }, []);

  const [formTemplate, setFormTemplateRaw] = useState<OnboardingSection[]>(() => {
    try {
      const saved = localStorage.getItem('formTemplate');
      if (saved) return JSON.parse(saved);
    } catch {}
    return STATIC_SECTIONS;
  });

  const [formPhases, setFormPhasesRaw] = useState<FormPhase[]>(() => {
    try {
      const saved = localStorage.getItem('formPhases');
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_PHASES;
  });

  // Persist to localStorage on every change
  const setFormTemplate = useCallback((val: OnboardingSection[] | ((prev: OnboardingSection[]) => OnboardingSection[])) => {
    setFormTemplateRaw(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      try { localStorage.setItem('formTemplate', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const setFormPhases = useCallback((val: FormPhase[] | ((prev: FormPhase[]) => FormPhase[])) => {
    setFormPhasesRaw(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      try { localStorage.setItem('formPhases', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const resolveTicket = useCallback((id: string) => {
    setTickets(prev => prev.filter(t => t.id !== id));
    setNotifications(prev => [
      { id: `n-${Date.now()}`, title: 'Ticket Resolved', message: `Ticket ${id} has been marked as resolved.`, time: 'Just now', read: false, type: 'ticket' },
      ...prev,
    ]);
    // #19: Clean up state maps for resolved ticket
    setAutoReplyPausedTickets(prev => { const n = { ...prev }; delete n[id]; return n; });
    setAutoReplyHandedOffState(prev => { const n = { ...prev }; delete n[id]; return n; });
    setAutoReplyProcessingState(prev => { const n = { ...prev }; delete n[id]; return n; });
    setDraftRepliesState(prev => { const n = { ...prev }; delete n[id]; return n; });
  }, []);

  // Core optimistic send used by both initial send and retry. Transitions a
  // pending message through 'sending' → 'sent' | 'failed'.
  //
  // clientMessageId is the idempotency key for the outbound_send_idempotency
  // table. We claim the row BEFORE dispatch; a re-entrant call with the
  // same id (network retry, StrictMode re-render) loses the claim and
  // skips the remote send instead of double-dispatching.
  const runProxySend = useCallback((
    conversationId: string,
    text: string,
    ticketId: string,
    localId: number,
    clientMessageId: string,
    metadata?: Record<string, unknown>,
  ) => {
    const markStatus = (status: 'sending' | 'sent' | 'failed', error?: string) => {
      setPendingProxyMessages(prev => {
        const list = prev[ticketId] || [];
        const next = list.map(m =>
          m.id === localId
            ? { ...m, deliveryStatus: status, deliveryError: error }
            : m,
        );
        return { ...prev, [ticketId]: next };
      });
    };

    (async () => {
      const companyId = proxyCompanyIds[0] ?? 'delta-hq';
      try {
        const claim = await claimOutboundSend(supabaseClient, {
          companyId,
          threadKey: ticketId,
          clientMessageId,
        });
        if (!claim.won) {
          // Another instance of this send is already in flight or done.
          // Reflect its terminal state on the optimistic bubble so the
          // user isn't stuck on "sending…" forever.
          if (claim.existing?.status === 'delivered') {
            markStatus('sent');
          } else if (claim.existing?.status === 'failed') {
            markStatus('failed', claim.existing.error_message ?? 'Failed to send message');
          }
          return;
        }

        const token = await getAccessToken();
        if (!token) {
          markStatus('failed', 'Not authenticated — please sign in again');
          await markSendFailed(supabaseClient, {
            companyId, threadKey: ticketId, clientMessageId,
            errorMessage: 'Not authenticated',
          });
          return;
        }

        try {
          await sendProxyMessage(
            conversationId, text, token,
            { ...(metadata ? { metadata } : {}), clientMessageId },
          );
          markStatus('sent');
          await markSendDelivered(supabaseClient, {
            companyId, threadKey: ticketId, clientMessageId,
          });
        } catch (err: any) {
          const msg = err?.message ?? 'Failed to send message';
          markStatus('failed', msg);
          await markSendFailed(supabaseClient, {
            companyId, threadKey: ticketId, clientMessageId,
            errorMessage: msg,
          });
        }
      } catch (err: any) {
        markStatus('failed', err?.message ?? 'Failed to send message');
      }
    })();
  }, [proxyCompanyIds]);

  const addMessageToTicket = useCallback((ticketId: string, text: string) => {
    const ticket = tickets.find(t => t.id === ticketId);

    // For proxy channel tickets (WhatsApp, Instagram, LINE, Email): send via channel proxy.
    // We optimistically insert a pending message so the UI can show sending / failed states
    // with retry/delete affordances; the real row arrives later via Supabase Realtime and is
    // deduped by InboxView.
    if (ticket?.proxyConversationId && ticket?.proxyChannel) {
      const now = Date.now();
      // Local IDs live in a distinct numeric range from real proxy messages
      // (real ones start at 2_000_000 in proxy-mappers.ts); use a 3M offset.
      const localId = 3_000_000 + Math.floor(Math.random() * 1_000_000_000);
      const clientMessageId = newClientMessageId();
      const pending: Message = {
        id: localId,
        sender: 'agent',
        text,
        time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        createdAt: now,
        deliveryStatus: 'sending',
        clientMessageId,
      };
      setPendingProxyMessages(prev => ({
        ...prev,
        [ticketId]: [...(prev[ticketId] || []), pending],
      }));
      runProxySend(ticket.proxyConversationId, text, ticketId, localId, clientMessageId);
      setAutoReplyHandedOff(ticketId, false);
      return;
    }

    // For Firestore threads: send via Unibox API — message appears via onSnapshot
    if (ticket?.firestoreThreadId && ticket?.firestoreHostId) {
      const conn = firestoreConnections.find(c => c.hostId === ticket.firestoreHostId && c.status === 'connected');
      if (conn?.userId) {
        // Read the in-memory token held by useFirestoreConnections (hydrated
        // from Supabase KV at app boot). Never touch localStorage — tokens
        // are server-stored to survive logout and avoid XSS exfiltration.
        const token = getFirestoreToken(ticket.firestoreHostId);
        if (token) {
          // Claim a row in outbound_send_idempotency so that a duplicate
          // dispatch (network retry, StrictMode re-render) collapses to a
          // single Unibox POST. Firestore round-trip delivers the message
          // to the UI; no optimistic bubble here (yet).
          const clientMessageId = newClientMessageId();
          const companyId = proxyCompanyIds[0] ?? 'delta-hq';
          (async () => {
            try {
              const claim = await claimOutboundSend(supabaseClient, {
                companyId, threadKey: ticketId, clientMessageId,
              });
              if (!claim.won) return;
              await sendGuestMessage(ticket.firestoreThreadId!, conn.userId, text, token);
              await markSendDelivered(supabaseClient, {
                companyId, threadKey: ticketId, clientMessageId,
              });
            } catch (err: any) {
              await markSendFailed(supabaseClient, {
                companyId, threadKey: ticketId, clientMessageId,
                errorMessage: err?.message ?? 'send failed',
              });
              toast.error('Failed to send message', { description: err?.message });
            }
          })();
          setAutoReplyHandedOff(ticketId, false);
          return;
        }
      }
      toast.error('Cannot send — inbox connection not found. Check Settings > Connected Inboxes.');
      return;
    }

    // For mock/devMode threads: in-memory push
    const now = Date.now();
    setTickets(prev => prev.map(t => {
      if (t.id !== ticketId) return t;
      const msgs = t.messages || [];
      const maxId = msgs.length > 0 ? Math.max(...msgs.map(m => m.id)) : 0;
      const newMsg: Message = {
        id: maxId + 1,
        sender: 'agent' as const,
        text,
        time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        createdAt: now,
      };
      return { ...t, messages: [...msgs, newMsg] };
    }));
    setAutoReplyHandedOff(ticketId, false);
  }, [tickets, firestoreConnections, setAutoReplyHandedOff, runProxySend]);

  /** Re-send a previously-failed pending proxy message. */
  const retryPendingProxyMessage = useCallback((ticketId: string, localMessageId: number) => {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket?.proxyConversationId) return;
    const pending = (pendingProxyMessages[ticketId] || []).find(m => m.id === localMessageId);
    if (!pending) return;

    // Retry needs a FRESH client_message_id — the previous one's row is in
    // status='failed' and its PK is permanent. Mint a new UUID and update
    // the pending bubble so any subsequent retry is idempotent on its own.
    const retryClientMessageId = newClientMessageId();
    setPendingProxyMessages(prev => ({
      ...prev,
      [ticketId]: (prev[ticketId] || []).map(m =>
        m.id === localMessageId
          ? {
              ...m,
              deliveryStatus: 'sending' as const,
              deliveryError: undefined,
              clientMessageId: retryClientMessageId,
            }
          : m,
      ),
    }));
    runProxySend(ticket.proxyConversationId, pending.text, ticketId, localMessageId, retryClientMessageId);
  }, [tickets, pendingProxyMessages, runProxySend]);

  /** Drop a pending proxy message (after failure, or to dedupe post-delivery). */
  const deletePendingProxyMessage = useCallback((ticketId: string, localMessageId: number) => {
    setPendingProxyMessages(prev => {
      const list = prev[ticketId] || [];
      const next = list.filter(m => m.id !== localMessageId);
      if (next.length === 0) {
        const copy = { ...prev };
        delete copy[ticketId];
        return copy;
      }
      return { ...prev, [ticketId]: next };
    });
  }, []);

  const injectGuestMessage = useCallback((ticketId: string, text: string, isGuestModeFlag = false) => {
    const now = Date.now();
    setTickets(prev => prev.map(t => {
      if (t.id !== ticketId) return t;
      const maxId = (t.messages || []).length > 0 ? Math.max(...(t.messages || []).map(m => m.id)) : 0;
      const newMsg: Message = {
        id: maxId + 1,
        sender: 'guest' as const,
        text,
        time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        createdAt: now,
        isGuestMode: isGuestModeFlag || undefined, // #7: flag test messages so AI skips them
      };
      return { ...t, messages: [...(t.messages || []), newMsg] };
    }));
  }, []);

  const addBotMessage = useCallback((ticketId: string, text: string) => {
    const ticket = tickets.find(t => t.id === ticketId);

    // For proxy channel tickets: send via channel proxy (AI auto-reply)
    // Use the same optimistic pending pattern as manual sends so the UI shows
    // a sending indicator until the real message arrives via Supabase Realtime.
    if (ticket?.proxyConversationId && ticket?.proxyChannel) {
      const now = Date.now();
      const localId = 3_000_000 + Math.floor(Math.random() * 1_000_000_000);
      const clientMessageId = newClientMessageId();
      const pending: Message = {
        id: localId, sender: 'bot', text,
        time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        createdAt: now, deliveryStatus: 'sending', clientMessageId,
      };
      setPendingProxyMessages(prev => ({
        ...prev,
        [ticketId]: [...(prev[ticketId] || []), pending],
      }));
      markBotSent(supabaseClient, ticket.proxyCompanyId ?? 'delta-hq', ticket.id, text, now);
      runProxySend(ticket.proxyConversationId, text, ticketId, localId, clientMessageId, { source: 'bot' });
      return;
    }

    // For Firestore-backed tickets: send via Unibox API so message is delivered
    // to the actual channel and written to Firestore. It appears via onSnapshot.
    if (ticket?.firestoreThreadId && ticket?.firestoreHostId) {
      const conn = firestoreConnections.find(c => c.hostId === ticket.firestoreHostId && c.status === 'connected');
      if (conn?.userId) {
        const token = getFirestoreToken(ticket.firestoreHostId);
        if (token) {
          markBotSent(supabaseClient, proxyCompanyIds[0] ?? 'delta-hq', ticket.id, text, Date.now());
          const clientMessageId = newClientMessageId();
          const companyId = proxyCompanyIds[0] ?? 'delta-hq';
          (async () => {
            try {
              const claim = await claimOutboundSend(supabaseClient, {
                companyId, threadKey: ticket.id, clientMessageId,
              });
              if (!claim.won) return;
              await sendGuestMessage(ticket.firestoreThreadId!, conn.userId, text, token);
              await markSendDelivered(supabaseClient, {
                companyId, threadKey: ticket.id, clientMessageId,
              });
            } catch (err: any) {
              console.error('[AutoReply] Failed to send bot reply via Unibox:', err);
              toast.error('AI reply failed to send', { description: err?.message });
              await markSendFailed(supabaseClient, {
                companyId, threadKey: ticket.id, clientMessageId,
                errorMessage: err?.message ?? 'send failed',
              });
            }
          })();
          return; // Message appears in UI via Firestore onSnapshot
        }
      }
      console.warn('[AutoReply] Cannot send bot message — no token for host:', ticket.firestoreHostId);
      return;
    }
    // Mock / devMode: in-memory only
    const now = Date.now();
    setTickets(prev => prev.map(t => {
      if (t.id !== ticketId) return t;
      const maxId = (t.messages || []).length > 0 ? Math.max(...(t.messages || []).map(m => m.id)) : 0;
      const newMsg: Message = {
        id: maxId + 1, sender: 'bot' as const, text,
        time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        createdAt: now,
      };
      return { ...t, messages: [...(t.messages || []), newMsg] };
    }));
  }, [tickets, firestoreConnections]);

  const addSystemMessage = useCallback((ticketId: string, text: string) => {
    const now = Date.now();
    setTickets(prev => prev.map(t => {
      if (t.id !== ticketId) return t;
      const maxId = (t.messages || []).length > 0 ? Math.max(...(t.messages || []).map(m => m.id)) : 0;
      const newMsg: Message = {
        id: maxId + 1, sender: 'system' as const, text,
        time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        createdAt: now,
      };
      return { ...t, messages: [...(t.messages || []), newMsg] };
    }));
  }, []);

  const addMultipleMessages = useCallback((ticketId: string, messages: { sender: Message['sender']; text: string }[]) => {
    const ticket = tickets.find(t => t.id === ticketId);

    // For proxy channel tickets: bot messages go via channel proxy with optimistic
    // pending state; system messages stay local as internal notes.
    if (ticket?.proxyConversationId && ticket?.proxyChannel) {
      const now = Date.now();
      for (const msg of messages) {
        if (msg.sender === 'bot') {
          const localId = 3_000_000 + Math.floor(Math.random() * 1_000_000_000);
          const clientMessageId = newClientMessageId();
          const pending: Message = {
            id: localId, sender: 'bot', text: msg.text,
            time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            createdAt: now, deliveryStatus: 'sending', clientMessageId,
          };
          setPendingProxyMessages(prev => ({
            ...prev,
            [ticketId]: [...(prev[ticketId] || []), pending],
          }));
          markBotSent(supabaseClient, ticket.proxyCompanyId ?? 'delta-hq', ticket.id, msg.text, now);
          runProxySend(ticket.proxyConversationId!, msg.text, ticketId, localId, clientMessageId, { source: 'bot' });
        }
      }
      const systemMsgs = messages.filter(m => m.sender === 'system');
      if (systemMsgs.length > 0) {
        const now = Date.now();
        setTickets(prev => prev.map(t => {
          if (t.id !== ticketId) return t;
          const maxId = (t.messages || []).length > 0 ? Math.max(...(t.messages || []).map(m => m.id)) : 0;
          const newMsgs: Message[] = systemMsgs.map((m, i) => ({
            id: maxId + 1 + i, sender: m.sender, text: m.text,
            time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            createdAt: now,
          }));
          return { ...t, messages: [...(t.messages || []), ...newMsgs] };
        }));
      }
      return;
    }

    // For Firestore-backed tickets: bot messages go via Unibox API; system messages stay local
    if (ticket?.firestoreThreadId && ticket?.firestoreHostId) {
      const conn = firestoreConnections.find(c => c.hostId === ticket.firestoreHostId && c.status === 'connected');
      if (conn?.userId) {
        const token = getFirestoreToken(ticket.firestoreHostId);
        if (token) {
          const companyId = proxyCompanyIds[0] ?? 'delta-hq';
          for (const msg of messages) {
            if (msg.sender === 'bot') {
              markBotSent(supabaseClient, companyId, ticket.id, msg.text, Date.now());
              const clientMessageId = newClientMessageId();
              (async () => {
                try {
                  const claim = await claimOutboundSend(supabaseClient, {
                    companyId, threadKey: ticket.id, clientMessageId,
                  });
                  if (!claim.won) return;
                  await sendGuestMessage(ticket.firestoreThreadId!, conn.userId, msg.text, token);
                  await markSendDelivered(supabaseClient, {
                    companyId, threadKey: ticket.id, clientMessageId,
                  });
                } catch (err: any) {
                  console.error('[AutoReply] Failed to send bot reply via Unibox:', err);
                  await markSendFailed(supabaseClient, {
                    companyId, threadKey: ticket.id, clientMessageId,
                    errorMessage: err?.message ?? 'send failed',
                  });
                }
              })();
            }
          }
        }
      }
      // System messages are internal notes — store locally so agents see them
      const systemMsgs = messages.filter(m => m.sender === 'system');
      if (systemMsgs.length > 0) {
        const now = Date.now();
        setTickets(prev => prev.map(t => {
          if (t.id !== ticketId) return t;
          const maxId = (t.messages || []).length > 0 ? Math.max(...(t.messages || []).map(m => m.id)) : 0;
          const newMsgs: Message[] = systemMsgs.map((m, i) => ({
            id: maxId + 1 + i, sender: m.sender, text: m.text,
            time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            createdAt: now,
          }));
          return { ...t, messages: [...(t.messages || []), ...newMsgs] };
        }));
      }
      return;
    }
    // Mock / devMode: in-memory only
    const now = Date.now();
    setTickets(prev => prev.map(t => {
      if (t.id !== ticketId) return t;
      const maxId = (t.messages || []).length > 0 ? Math.max(...(t.messages || []).map(m => m.id)) : 0;
      const newMsgs: Message[] = messages.map((m, i) => ({
        id: maxId + 1 + i, sender: m.sender, text: m.text,
        time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        createdAt: now,
      }));
      return { ...t, messages: [...(t.messages || []), ...newMsgs] };
    }));
  }, [tickets, firestoreConnections]);

  const escalateTicketStatus = useCallback((ticketId: string) => {
    setTickets(prev => prev.map(t => {
      if (t.id !== ticketId) return t;
      if (t.status === 'normal') {
        return { ...t, status: 'warning' as const, sla: '12h' };
      }
      return t;
    }));
  }, []);

  const escalateTicketWithUrgency = useCallback((ticketId: string, level: 'warning' | 'urgent', sla: string) => {
    const now = Date.now();
    // Persist escalation override for Firestore threads
    setEscalationOverrides(prev => ({ ...prev, [ticketId]: { level, setAt: now } }));
    // Also update in-memory ticket for immediate UI feedback
    setTickets(prev => prev.map(t => {
      if (t.id !== ticketId) return t;
      return { ...t, status: level, sla, slaSetAt: now };
    }));
  }, []);

  const deescalateTicket = useCallback((ticketId: string) => {
    // Clear escalation override
    setEscalationOverrides(prev => {
      const next = { ...prev };
      delete next[ticketId];
      return next;
    });
    // Clear handover reason on de-escalation
    setHandoverReasons(prev => {
      const next = { ...prev };
      delete next[ticketId];
      return next;
    });
    setTickets(prev => prev.map(t => {
      if (t.id !== ticketId) return t;
      return { ...t, status: 'normal' as const, sla: '24:00', slaSetAt: Date.now() };
    }));
  }, []);

  const deleteMessageFromTicket = useCallback((ticketId: string, messageId: number) => {
    setTickets(prev => prev.map(t => {
      if (t.id !== ticketId) return t;
      const newMessages = (t.messages || []).filter(m => m.id !== messageId);
      return { ...t, messages: newMessages };
    }));
  }, []);

  const deleteThread = useCallback((ticketId: string) => {
    setTickets(prev => prev.filter(t => t.id !== ticketId));
    // #19: Clean up state maps for deleted ticket to prevent unbounded growth
    setAutoReplyPausedTickets(prev => { const n = { ...prev }; delete n[ticketId]; return n; });
    setAutoReplyHandedOffState(prev => { const n = { ...prev }; delete n[ticketId]; return n; });
    setAutoReplyProcessingState(prev => { const n = { ...prev }; delete n[ticketId]; return n; });
    setDraftRepliesState(prev => { const n = { ...prev }; delete n[ticketId]; return n; });
  }, []);

  // ─── Knowledge Chunks + Ingested Documents mutators ───────────────────────
  //
  // Write model: optimistic state update, then async Supabase upsert. The
  // IndexedDB cache-write effect further down picks up the state change and
  // mirrors it locally so offline readers still work.
  //
  // Realtime events from other tabs come in through a separate subscription
  // and feed back into the same setState — upserts are idempotent by `id`
  // so concurrent tabs converge on the same final state without loops.
  const companyIdRef = useRef<string | null>(null);

  const upsertKnowledgeChunks = useCallback((chunks: KnowledgeChunk[]) => {
    setKnowledgeChunks(prev => {
      const byId = new Map(prev.map(c => [c.id, c]));
      for (const c of chunks) byId.set(c.id, c);
      return Array.from(byId.values());
    });
    const companyId = companyIdRef.current;
    if (!companyId) return;
    // Queued: failed writes retry with exponential backoff + online flush.
    kbPersist.enqueueUpsertChunks(chunks, companyId);
  }, []);

  const updateKnowledgeChunk = useCallback((id: string, updates: Partial<KnowledgeChunk>) => {
    const nowIso = new Date().toISOString();
    setKnowledgeChunks(prev => prev.map(c =>
      c.id === id ? { ...c, ...updates, updatedAt: nowIso } : c,
    ));
    kbPersist.enqueueUpdateChunk(id, updates);
  }, []);

  const deleteKnowledgeChunks = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    setKnowledgeChunks(prev => prev.filter(c => !idSet.has(c.id)));
    kbPersist.enqueueDeleteChunks(ids);
  }, []);

  const upsertIngestedDocument = useCallback((doc: IngestedDocument) => {
    setIngestedDocuments(prev => {
      const idx = prev.findIndex(d => d.id === doc.id);
      if (idx === -1) return [...prev, doc];
      const next = [...prev];
      next[idx] = doc;
      return next;
    });
    const companyId = companyIdRef.current;
    if (!companyId) return;
    kbPersist.enqueueUpsertDoc(doc, companyId);
  }, []);

  const deleteIngestedDocument = useCallback((id: string) => {
    setIngestedDocuments(prev => prev.filter(d => d.id !== id));
    kbPersist.enqueueDeleteDoc(id);
  }, []);

  // Legacy KB mutators — now write to `knowledge_chunks` under the hood.
  // `kbEntries` is a read-only derived view, so these callers still get
  // their expected behavior, but the data flows through the single
  // canonical store that every AI path reads from.
  //
  // Declared AFTER the chunk mutators so the useCallback deps arrays
  // below resolve without TDZ errors at render time.
  const addKBEntry = useCallback(async (entry: Omit<KBEntry, 'id'>) => {
    const nowIso = new Date().toISOString();
    const timestamp = Date.now();
    const chunkId = `manual-${timestamp}`;
    const hash = await stableHash(JSON.stringify({ title: entry.title, body: entry.content }));
    upsertKnowledgeChunks([{
      id: chunkId,
      hostId: entry.hostId,
      propId: entry.propId,
      roomId: entry.roomId,
      kind: 'property_fact',
      title: entry.title,
      body: entry.content,
      chunkHash: hash,
      structured: entry.sectionId ? { sectionId: entry.sectionId } : undefined,
      source: { type: 'manual', extractedAt: nowIso, editedBy: 'agent' },
      visibility: entry.internal ? 'internal' : 'guest_facing',
      status: 'active',
      tags: entry.tags || [],
      createdAt: nowIso,
      updatedAt: nowIso,
    }]);
  }, [upsertKnowledgeChunks]);

  const updateKBEntry = useCallback(async (id: number, updates: Partial<KBEntry>) => {
    const chunkId = `manual-${id}`;
    const patch: Partial<KnowledgeChunk> = {};
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.content !== undefined) patch.body = updates.content;
    if (updates.tags !== undefined) patch.tags = updates.tags;
    if (updates.internal !== undefined) {
      patch.visibility = updates.internal ? 'internal' : 'guest_facing';
    }
    if (updates.content !== undefined || updates.title !== undefined) {
      patch.chunkHash = await stableHash(JSON.stringify({
        title: updates.title ?? '',
        body: updates.content ?? '',
      }));
    }
    updateKnowledgeChunk(chunkId, patch);
  }, [updateKnowledgeChunk]);

  const deleteKBEntry = useCallback((id: number) => {
    deleteKnowledgeChunks([`manual-${id}`]);
  }, [deleteKnowledgeChunks]);

  const deleteKBEntriesBySource = useCallback((propId: string, source: 'onboarding' | 'manual') => {
    // Only the 'manual' branch was ever actively used. We find every
    // manual chunk scoped to this property and delete them in one batch.
    if (source !== 'manual') return;
    const ids = knowledgeChunksRef.current
      .filter(c => c.source.type === 'manual' && c.propId === propId)
      .map(c => c.id);
    if (ids.length > 0) deleteKnowledgeChunks(ids);
  }, [deleteKnowledgeChunks]);

  const markNotificationRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const updateHostSettings = useCallback((hostId: string, updates: Partial<HostSettings>) => {
    setHostSettings(prev => {
      const exists = prev.some(s => s.hostId === hostId);
      const next = exists
        ? prev.map(s => s.hostId === hostId ? { ...s, ...updates } : s)
        : [...prev, { hostId, tone: 'professional', autoReply: false, autoReplyMode: 'auto' as const, partialCoverage: 'answer-and-escalate', zeroCoverage: 'holding-message', cooldownEnabled: false, cooldownMinutes: 10, debouncePreset: 'instant', safetyKeywords: [...DEFAULT_SAFETY_KEYWORDS], activeHours: { enabled: false, startHour: 9, endHour: 21, displayHours: '9am–9pm daily' }, ...updates }];
      syncPrefToBackend('hostSettings', next);
      return next;
    });
  }, [syncPrefToBackend]);

  const addProperty = useCallback((prop: Property) => {
    setProperties(prev => [...prev, prop]);
    // Best-effort backend save
    (async () => {
      try {
        const { addProperty: addPropApi } = await getApiClient();
        await addPropApi(prop);
      } catch (err) {
        console.error('Failed to persist property to backend:', err);
      }
    })();
  }, []);

  const updatePropertyStatus = useCallback((id: string, status: Property['status']) => {
    setProperties(prev => prev.map(p => p.id === id ? { ...p, status } : p));
    // Best-effort backend save
    (async () => {
      try {
        const { updatePropertyStatus: updatePropApi } = await getApiClient();
        await updatePropApi(id, status);
      } catch (err) {
        console.error('Failed to update property status in backend:', err);
      }
    })();
  }, []);

  const updatePropertyMeta = useCallback((id: string, updates: Partial<Property>) => {
    setProperties(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);

  const deleteProperty = useCallback((id: string) => {
    setProperties(prev => prev.filter(p => p.id !== id));
    // Best-effort backend save
    (async () => {
      try {
        const { deleteProperty: deletePropApi } = await getApiClient();
        await deletePropApi(id);
      } catch (err) {
        console.error('Failed to delete property from backend:', err);
      }
    })();
  }, []);

  // FAQ dual-write: the form stores FAQs as a JSON array under the single
  // `faqs__items` key; `knowledge_chunks` wants one row per Q/A pair. This
  // helper reconciles both — fired from setOnboardingField when that key
  // changes. Each FAQ gets a stable id `form-faq-${propId}-${faqId}` so
  // re-saves are idempotent. Removed FAQs are archived (90d TTL), not
  // hard-deleted, matching the property_fact semantics below.
  //
  // Declared BEFORE setOnboardingField so its identifier is initialised
  // by the time that callback's deps array is evaluated during render.
  const syncFaqsToChunks = useCallback(async (propertyId: string, faqsJson: string) => {
    const prop = properties.find(p => p.id === propertyId);
    if (!prop) return;

    type FaqItem = { id: string; question: string; answer: string; language?: string };
    let items: FaqItem[] = [];
    try {
      const parsed = JSON.parse(faqsJson);
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      return; // malformed JSON — the form editor handles validation
    }

    const seenIds = new Set<string>();
    const chunksToUpsert: KnowledgeChunk[] = [];
    const nowIso = new Date().toISOString();

    for (const faq of items) {
      const q = (faq.question ?? '').trim();
      const a = (faq.answer ?? '').trim();
      if (!q || !a) continue; // half-filled rows don't become chunks
      const chunkId = `form-faq-${propertyId}-${faq.id}`;
      seenIds.add(chunkId);
      const hash = await stableHash(JSON.stringify({ q, a, lang: faq.language }));
      chunksToUpsert.push({
        id: chunkId,
        hostId: prop.hostId,
        propId: propertyId,
        roomId: null,
        kind: 'faq',
        title: q.length > 80 ? q.slice(0, 77) + '…' : q,
        body: a,
        chunkHash: hash,
        structured: { question: q, answer: a, language: faq.language },
        source: { type: 'form', extractedAt: nowIso, editedBy: 'agent' },
        visibility: 'guest_facing',
        status: 'active',
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }

    if (chunksToUpsert.length > 0) upsertKnowledgeChunks(chunksToUpsert);

    // Archive any previously-mirrored FAQ chunk that's no longer in the
    // form list — preserves audit trail, recoverable via Inspector's
    // Archived tab within 90 days.
    const stalePrefix = `form-faq-${propertyId}-`;
    for (const c of knowledgeChunksRef.current) {
      if (!c.id.startsWith(stalePrefix)) continue;
      if (c.status !== 'active') continue;
      if (seenIds.has(c.id)) continue;
      updateKnowledgeChunk(c.id, { status: 'archived' });
    }
  }, [properties, upsertKnowledgeChunks, updateKnowledgeChunk]);

  // Atomic form → knowledge_chunks mirror.
  //
  // Every form field write is simultaneously written to `onboardingData`
  // (form UI state) AND mirrored as a `property_fact` chunk in
  // `knowledge_chunks` (canonical AI-readable store). No debounce, no
  // gap — the moment a user types, the chunk is in state and queued
  // for Supabase.
  //
  // `buildFormFactChunk` is pure and synchronous (chunkHash is an
  // awaitable stableHash, so we build it async inside the callback).
  const setOnboardingField = useCallback(async (propertyId: string, key: string, value: string) => {
    setOnboardingData(prev => ({
      ...prev,
      [propertyId]: { ...prev[propertyId], [key]: value },
    }));

    // FAQs — the form stores them as a JSON array under `faqs__items`.
    // Mirror each Q/A pair as a `kind='faq'` chunk with a stable id so
    // the Inspector and the AI see them through the unified store.
    if (key === 'faqs__items') {
      await syncFaqsToChunks(propertyId, value);
      return;
    }
    // Form metadata (author, dates) is agent-only scaffolding, not KB.
    if (key.startsWith('faqs__') || key.startsWith('_meta__')) return;

    const prop = properties.find(p => p.id === propertyId);
    if (!prop) return;
    const roomNames = prop.roomNames
      ?? (prop.units === 1 ? ['Entire Property']
          : Array.from({ length: prop.units }, (_, i) => `Unit ${i + 1}`));
    const parsed = parseFormKey(key, formTemplate, roomNames);
    if (!parsed) return;

    const chunkId = `form-${propertyId}-${parsed.slotKey}`;
    const trimmed = value.trim();
    if (!trimmed) {
      // Cleared field → archive any existing chunk (90-day TTL).
      const existing = knowledgeChunksRef.current.find(c => c.id === chunkId);
      if (existing && existing.status === 'active') {
        updateKnowledgeChunk(chunkId, { status: 'archived' });
      }
      return;
    }

    const nowIso = new Date().toISOString();
    const hash = await stableHash(JSON.stringify({ body: trimmed, slotKey: parsed.slotKey }));
    upsertKnowledgeChunks([{
      id: chunkId,
      hostId: prop.hostId,
      propId: propertyId,
      roomId: parsed.roomId,
      kind: 'property_fact',
      title: parsed.roomName ? `${parsed.roomName} — ${parsed.fieldLabel}` : parsed.fieldLabel,
      body: trimmed,
      chunkHash: hash,
      structured: {
        sectionId: parsed.sectionId,
        sectionTitle: parsed.sectionTitle,
        fieldId: parsed.fieldId,
        fieldLabel: parsed.fieldLabel,
        roomName: parsed.roomName,
      },
      slotKey: parsed.slotKey,
      isOverride: true,
      source: { type: 'form', extractedAt: nowIso, editedBy: 'agent' },
      visibility: parsed.hostHidden ? 'internal' : 'guest_facing',
      status: 'active',
      createdAt: nowIso,
      updatedAt: nowIso,
    }]);
  }, [properties, formTemplate, updateKnowledgeChunk, upsertKnowledgeChunks, syncFaqsToChunks]);

  const setOnboardingBulk = useCallback(async (propertyId: string, data: Record<string, string>) => {
    setOnboardingData(prev => ({
      ...prev,
      [propertyId]: { ...prev[propertyId], ...data },
    }));

    const prop = properties.find(p => p.id === propertyId);
    if (!prop) return;
    const roomNames = prop.roomNames
      ?? (prop.units === 1 ? ['Entire Property']
          : Array.from({ length: prop.units }, (_, i) => `Unit ${i + 1}`));

    const chunksToUpsert: KnowledgeChunk[] = [];
    const idsToArchive: string[] = [];
    const nowIso = new Date().toISOString();

    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('faqs__') || key.startsWith('_meta__')) continue;
      const parsed = parseFormKey(key, formTemplate, roomNames);
      if (!parsed) continue;
      const chunkId = `form-${propertyId}-${parsed.slotKey}`;
      const trimmed = value.trim();
      if (!trimmed) {
        idsToArchive.push(chunkId);
        continue;
      }
      const hash = await stableHash(JSON.stringify({ body: trimmed, slotKey: parsed.slotKey }));
      chunksToUpsert.push({
        id: chunkId,
        hostId: prop.hostId,
        propId: propertyId,
        roomId: parsed.roomId,
        kind: 'property_fact',
        title: parsed.roomName ? `${parsed.roomName} — ${parsed.fieldLabel}` : parsed.fieldLabel,
        body: trimmed,
        chunkHash: hash,
        structured: {
          sectionId: parsed.sectionId,
          sectionTitle: parsed.sectionTitle,
          fieldId: parsed.fieldId,
          fieldLabel: parsed.fieldLabel,
          roomName: parsed.roomName,
        },
        slotKey: parsed.slotKey,
        isOverride: true,
        source: { type: 'form', extractedAt: nowIso, editedBy: 'agent' },
        visibility: parsed.hostHidden ? 'internal' : 'guest_facing',
        status: 'active',
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }

    if (chunksToUpsert.length > 0) upsertKnowledgeChunks(chunksToUpsert);
    for (const id of idsToArchive) {
      const existing = knowledgeChunksRef.current.find(c => c.id === id);
      if (existing && existing.status === 'active') updateKnowledgeChunk(id, { status: 'archived' });
    }
    // Mirror FAQ blob if present in the bulk payload.
    if (data['faqs__items']) await syncFaqsToChunks(propertyId, data['faqs__items']);
  }, [properties, formTemplate, updateKnowledgeChunk, upsertKnowledgeChunks, syncFaqsToChunks]);

  // Persist onboardingData to localStorage so host portal changes survive AppProvider re-creation
  useEffect(() => {
    try { localStorage.setItem('onboardingData', JSON.stringify(onboardingData)); } catch {}
  }, [onboardingData]);

  // NOTE: The debounced `syncFormToChunks` effect was removed. Form→chunk
  // mirroring is now ATOMIC inside `setOnboardingField` / `setOnboardingBulk`
  // above — every form write instantly lands as a property_fact chunk in
  // state and is queued for Supabase. No 1s gap, no derivation fallback.
  //
  // One-time BACKFILL effect:
  //
  // PREFILLED_ONBOARDING demo data (and any form data persisted before
  // this refactor) lives in `onboardingData` state but was never routed
  // through the atomic mirror. Without this effect, AI prompts for those
  // properties would see an empty KB — the legacy derivation that used
  // to salvage them was deleted in Step 6 of the clean-data-model
  // refactor.
  //
  // Runs ONCE per session, after:
  //   - IndexedDB cache hydrate (so chunks state reflects local data)
  //   - Supabase server sync (so we don't re-upload chunks the server
  //     already has)
  //   - companyIdRef is set (required for Supabase writes)
  //
  // Idempotent by chunk hash: rows whose slotKey+body are unchanged
  // produce the same chunk id and collapse into a no-op upsert.
  const backfillDoneRef = useRef(false);
  useEffect(() => {
    if (backfillDoneRef.current) return;
    if (!chunksHydrated.current) return;
    if (!serverSyncedRef.current) return;
    if (!companyIdRef.current) return;

    backfillDoneRef.current = true;
    (async () => {
      let backfilled = 0;
      for (const [propertyId, fields] of Object.entries(onboardingData)) {
        const prop = properties.find(p => p.id === propertyId);
        if (!prop) continue;
        const fieldCount = Object.keys(fields).filter(k =>
          !k.startsWith('_meta__')
        ).length;
        if (fieldCount === 0) continue;
        // setOnboardingBulk handles the full property_fact + FAQ mirror
        // with deterministic chunk ids, so re-uploading existing data
        // is a no-op at the Supabase level (same content hash).
        await setOnboardingBulk(propertyId, fields);
        backfilled += fieldCount;
      }
      if (backfilled > 0) {
        console.log(`[KB Backfill] ✓ Mirrored ${backfilled} pre-existing form fields → knowledge_chunks (${Object.keys(onboardingData).length} properties)`);
      }
    })();
  }, [onboardingData, properties, setOnboardingBulk]);

  const addCustomFormSection = useCallback((propertyId: string, title: string) => {
    const newSectionId = `sec-${Date.now()}`;
    setCustomFormSections(prev => ({
      ...prev,
      [propertyId]: [
        ...(prev[propertyId] || []),
        { id: newSectionId, title },
      ],
    }));
    return newSectionId;
  }, []);

  const removeCustomFormSection = useCallback((propertyId: string, sectionId: string) => {
    setCustomFormSections(prev => ({
      ...prev,
      [propertyId]: (prev[propertyId] || []).filter(s => s.id !== sectionId),
    }));
  }, []);

  const renameCustomFormSection = useCallback((propertyId: string, sectionId: string, title: string) => {
    setCustomFormSections(prev => ({
      ...prev,
      [propertyId]: (prev[propertyId] || []).map(s => s.id === sectionId ? { ...s, title } : s),
    }));
  }, []);

  const updateFormSection = useCallback((sectionId: string, updates: Partial<OnboardingSection>) => {
    setFormTemplate(prev => prev.map(s => s.id === sectionId ? { ...s, ...updates } : s));
  }, []);

  const addFormSection = useCallback((section: OnboardingSection) => {
    setFormTemplate(prev => [...prev, section]);
  }, []);

  const removeFormSection = useCallback((sectionId: string) => {
    setFormTemplate(prev => prev.filter(s => s.id !== sectionId));
  }, []);

  const reorderFormSections = useCallback((fromIndex: number, toIndex: number) => {
    setFormTemplate(prev => {
      const result = [...prev];
      const [removed] = result.splice(fromIndex, 1);
      result.splice(toIndex, 0, removed);
      return result;
    });
  }, []);

  const updateFormField = useCallback((sectionId: string, fieldId: string, updates: Partial<OnboardingField>) => {
    setFormTemplate(prev => prev.map(s => s.id === sectionId ? {
      ...s,
      fields: s.fields.map(f => f.id === fieldId ? { ...f, ...updates } : f),
    } : s));
  }, []);

  const addFormField = useCallback((sectionId: string, field: OnboardingField) => {
    setFormTemplate(prev => prev.map(s => s.id === sectionId ? {
      ...s,
      fields: [...s.fields, field],
    } : s));
  }, []);

  const removeFormField = useCallback((sectionId: string, fieldId: string) => {
    setFormTemplate(prev => prev.map(s => s.id === sectionId ? {
      ...s,
      fields: s.fields.filter(f => f.id !== fieldId),
    } : s));
  }, []);

  const reorderFormFields = useCallback((sectionId: string, fromIndex: number, toIndex: number) => {
    setFormTemplate(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      const fields = [...s.fields];
      const [removed] = fields.splice(fromIndex, 1);
      fields.splice(toIndex, 0, removed);
      return { ...s, fields };
    }));
  }, []);

  const resetFormTemplate = useCallback(() => {
    setFormTemplate(STATIC_SECTIONS);
  }, []);

  const addFormPhase = useCallback((phase: FormPhase) => {
    setFormPhases(prev => [...prev, phase]);
  }, []);

  const updateFormPhase = useCallback((id: number, updates: Partial<Omit<FormPhase, 'id'>>) => {
    setFormPhases(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);

  const removeFormPhase = useCallback((id: number) => {
    setFormPhases(prev => prev.filter(p => p.id !== id));
  }, []);

  const reorderFormPhases = useCallback((fromIndex: number, toIndex: number) => {
    setFormPhases(prev => {
      const result = [...prev];
      const [removed] = result.splice(fromIndex, 1);
      result.splice(toIndex, 0, removed);
      return result;
    });
  }, []);

  const resetFormPhases = useCallback(() => {
    setFormPhases(DEFAULT_PHASES);
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  // ─── Load onboarding data from Supabase on startup ──────────────────────────
  useEffect(() => {
    const propIds = properties.map(p => p.id).join(',');
    if (!propIds) return;

    (async () => {
      try {
        const res = await edgeFetch(`/onboarding/load?propIds=${encodeURIComponent(propIds)}`);
        if (!res.ok) return;
        const { data } = await res.json();
        if (!data || typeof data !== 'object') return;

        const entries = Object.entries(data) as [string, Record<string, string>][];
        if (entries.length === 0) return;

        // Merge server data into onboarding state (server wins), then recompose KB
        setOnboardingData(prev => {
          const merged = { ...prev };
          for (const [propId, formData] of entries) {
            merged[propId] = { ...(prev[propId] || {}), ...formData };
          }
          return merged;
        });

        console.log(`[KB Sync] ✓ Loaded onboarding from Supabase for ${entries.length} properties`);
      } catch (err) {
        console.log('[KB Sync] Supabase load skipped (offline or no data):', err);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // ─── Auto-persist manual KB entries when they change ────────────────────────
  useEffect(() => {
    if (kbEntries.length === 0) return;

    const persistKBToDB = () => {
      try {
        localStorage.setItem('kb_entries_all', JSON.stringify(kbEntries));
        console.log(`[KB Persist] ✓ Saved ${kbEntries.length} entries to localStorage`);
      } catch (err) {
        console.log('[KB Persist] localStorage failed:', err);
      }
    };

    // Debounce persist by 500ms to avoid excessive saves during rapid form edits
    const timer = setTimeout(() => {
      persistKBToDB();
    }, 500);

    return () => clearTimeout(timer);
  }, [kbEntries]);

  // ─── Knowledge Chunks + Ingested Documents persistence ─────────────────
  //
  // Storage layers (in order of authority):
  //   1. Supabase (canonical, multi-device, RLS-scoped)
  //   2. IndexedDB (instant-render cache — shows data before network resolves)
  //   3. React state (runtime)
  //
  // Hydrate flow:
  //   a) Read IndexedDB → setState immediately (instant UI on page load,
  //      works offline too)
  //   b) Fetch from Supabase → setState again (canonical state wins)
  //   c) Subscribe to realtime changes → incremental merges forever
  //
  // Write flow:
  //   Mutators (upsertKnowledgeChunks etc.) already write to Supabase +
  //   update state. The IndexedDB mirror effect below snapshots current
  //   state on every change, so the local cache stays warm.
  const chunksHydrated = useRef(false);
  const docsHydrated = useRef(false);
  const serverSyncedRef = useRef(false);

  // Seed companyIdRef once proxyCompanyIds resolves. The prototype fallback
  // yields 'delta-hq' for any authenticated user when no explicit mapping
  // exists, so a warmed session always has a valid scope.
  useEffect(() => {
    if (proxyCompanyIds.length > 0) {
      companyIdRef.current = proxyCompanyIds[0];
    }
  }, [proxyCompanyIds]);

  // Step 1 — IndexedDB hydrate (fast, offline-safe).
  useEffect(() => {
    (async () => {
      try {
        const [chunks, docs] = await Promise.all([
          kvGet<KnowledgeChunk[]>(STORAGE_KEYS.KB_CHUNKS),
          kvGet<IngestedDocument[]>(STORAGE_KEYS.INGESTED_DOCS),
        ]);
        // Race-safe merge: if the user wrote to state before hydrate
        // completed (e.g. import in <100ms), fresh user writes win over
        // stale cache values.
        if (Array.isArray(chunks)) {
          setKnowledgeChunks(prev => {
            if (prev.length === 0) return chunks;
            const byId = new Map(chunks.map(c => [c.id, c]));
            for (const c of prev) byId.set(c.id, c);
            return Array.from(byId.values());
          });
        }
        if (Array.isArray(docs)) {
          setIngestedDocuments(prev => {
            if (prev.length === 0) return docs;
            const byId = new Map(docs.map(d => [d.id, d]));
            for (const d of prev) byId.set(d.id, d);
            return Array.from(byId.values());
          });
        }
        console.log(`[KB Persist] ✓ Cache hydrated: ${chunks?.length ?? 0} chunks, ${docs?.length ?? 0} docs from IndexedDB`);
      } catch (err) {
        console.warn('[KB Persist] Cache hydrate failed:', err);
      } finally {
        chunksHydrated.current = true;
        docsHydrated.current = true;
      }
    })();
  }, []);

  // Step 2 — Supabase fetch (canonical). Waits for proxyCompanyIds so RLS
  // has a valid scope. Runs once per session; realtime handles updates.
  //
  // Also performs a one-time local→server migration: if the user has
  // chunks in their IndexedDB cache that don't exist on the server, we
  // upload them on first sync. Protects any work done before Supabase
  // was enabled and any offline work that hasn't round-tripped yet.
  useEffect(() => {
    if (proxyCompanyIds.length === 0) return;
    if (serverSyncedRef.current) return;
    serverSyncedRef.current = true;
    const companyId = proxyCompanyIds[0];
    (async () => {
      try {
        const [serverChunks, serverDocs] = await Promise.all([
          kbPersist.fetchAllChunks(),
          kbPersist.fetchAllDocs(),
        ]);

        // Snapshot current in-memory state so we can detect local-only
        // items. Read via the refs, not closure — state may have changed
        // since mount.
        const localChunks = knowledgeChunksRef.current;
        const localDocs = ingestedDocumentsRef.current;

        // local-only = present locally but absent on server. These are
        // either pre-migration writes or offline writes awaiting sync.
        const serverChunkIds = new Set(serverChunks.map(c => c.id));
        const orphanLocalChunks = localChunks.filter(c => !serverChunkIds.has(c.id));
        const serverDocIds = new Set(serverDocs.map(d => d.id));
        const orphanLocalDocs = localDocs.filter(d => !serverDocIds.has(d.id));

        if (orphanLocalChunks.length > 0 || orphanLocalDocs.length > 0) {
          console.log(`[KB Persist] Migrating ${orphanLocalChunks.length} chunks + ${orphanLocalDocs.length} docs from local cache → Supabase`);
          // Fire-and-forget — if it fails, the chunks stay in the local
          // cache and the next user action will retry via the mutators.
          if (orphanLocalChunks.length > 0) {
            kbPersist.upsertChunks(orphanLocalChunks, companyId).catch(err =>
              console.warn('[KB Persist] Migration upload failed:', err),
            );
          }
          for (const d of orphanLocalDocs) {
            kbPersist.upsertDoc(d, companyId).catch(err =>
              console.warn('[KB Persist] Doc migration upload failed:', err),
            );
          }
        }

        // Merge: server is canonical, but keep local-only items (will be
        // reconciled by the upload above or on next realtime tick) and
        // prefer newer-updatedAt between the two.
        setKnowledgeChunks(prev => {
          const byId = new Map(serverChunks.map(c => [c.id, c]));
          for (const c of prev) {
            const serverCopy = byId.get(c.id);
            if (!serverCopy) { byId.set(c.id, c); continue; }
            if (new Date(c.updatedAt) > new Date(serverCopy.updatedAt)) byId.set(c.id, c);
          }
          return Array.from(byId.values());
        });
        setIngestedDocuments(prev => {
          const byId = new Map(serverDocs.map(d => [d.id, d]));
          for (const d of prev) if (!byId.has(d.id)) byId.set(d.id, d);
          return Array.from(byId.values());
        });
        console.log(`[KB Persist] ✓ Synced from Supabase: ${serverChunks.length} chunks, ${serverDocs.length} docs`);
      } catch (err) {
        console.warn('[KB Persist] Supabase fetch failed — staying on IndexedDB cache:', err);
      }
    })();
  }, [proxyCompanyIds]);

  // Step 3 — Realtime. One tab's mutations become every other tab's
  // incremental merge. Keeps two agents on two devices in sync without
  // polling. Unsubscribe on provider unmount.
  useEffect(() => {
    if (proxyCompanyIds.length === 0) return;
    const unsub = kbPersist.subscribeKBRealtime({
      onChunkChange: (event, c) => {
        if (event === 'DELETE') {
          setKnowledgeChunks(prev => prev.filter(x => x.id !== c.id));
          return;
        }
        // INSERT / UPDATE — upsert by id.
        setKnowledgeChunks(prev => {
          const idx = prev.findIndex(x => x.id === c.id);
          if (idx === -1) return [...prev, c as KnowledgeChunk];
          const next = [...prev];
          next[idx] = c as KnowledgeChunk;
          return next;
        });
      },
      onDocChange: (event, d) => {
        if (event === 'DELETE') {
          setIngestedDocuments(prev => prev.filter(x => x.id !== d.id));
          return;
        }
        setIngestedDocuments(prev => {
          const idx = prev.findIndex(x => x.id === d.id);
          if (idx === -1) return [...prev, d as IngestedDocument];
          const next = [...prev];
          next[idx] = d as IngestedDocument;
          return next;
        });
      },
    });
    return unsub;
  }, [proxyCompanyIds]);

  // IndexedDB mirror — fire-and-forget cache writes on every state change.
  // Doesn't block UI; failure here is non-fatal (Supabase is canonical).
  useEffect(() => {
    if (!chunksHydrated.current) return;
    const timer = setTimeout(() => {
      kvSet(STORAGE_KEYS.KB_CHUNKS, knowledgeChunks)
        .then(() => console.log(`[KB Persist] ✓ Cached ${knowledgeChunks.length} chunks to IndexedDB`))
        .catch(err => console.warn('[KB Persist] Cache write failed:', err));
    }, 300);
    return () => clearTimeout(timer);
  }, [knowledgeChunks]);

  useEffect(() => {
    if (!docsHydrated.current) return;
    const timer = setTimeout(() => {
      kvSet(STORAGE_KEYS.INGESTED_DOCS, ingestedDocuments)
        .catch(err => console.warn('[KB Persist] Doc cache write failed:', err));
    }, 300);
    return () => clearTimeout(timer);
  }, [ingestedDocuments]);

  // ─── Manual sync to Supabase ─────────────────────────────────
  const manualSyncFormData = useCallback(async () => {
    const data = onboardingDataRef.current;
    if (Object.keys(data).length === 0) return;

    setFormPersistStatus('syncing');

    try {
      const response = await edgeFetch('/onboarding/save', {
        method: 'POST',
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.status}`);
      }

      setFormPersistStatus('server');
    } catch (error) {
      console.error('[Sync] Error:', error);
      setFormPersistStatus('local');
    }
  }, []); // stable — reads latest data via ref

  // ─── Auto-save onboarding form data to Supabase (debounced 2s) ──────────────
  // Fires on every form change from any touchpoint (OnboardingView, HostPortalView, etc.)
  useEffect(() => {
    if (Object.keys(onboardingData).length === 0) return;
    setFormPersistStatus('syncing');
    const timer = setTimeout(() => manualSyncFormData(), 2000);
    return () => clearTimeout(timer);
  }, [onboardingData]); // eslint-disable-line react-hooks/exhaustive-deps

  const [aiSettingsLoading, setAiSettingsLoading] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [maskedApiKey, setMaskedApiKey] = useState('');

  const refreshAISettings = useCallback(async () => {
    setAiSettingsLoading(true);
    try {
      const { getAISettings } = await getApiClient();
      const settings = await getAISettings();
      setHasApiKey(settings.hasApiKey);
      setMaskedApiKey(settings.maskedApiKey);
      setAiModelRaw(settings.model || 'openai/gpt-4o-mini');
      try { localStorage.setItem('aiModel', settings.model || 'openai/gpt-4o-mini'); } catch {}
      if (settings.importModel) {
        setImportAiModelRaw(settings.importModel);
        try { localStorage.setItem('importAiModel', settings.importModel); } catch {}
      }
    } catch (err) {
      console.error('Failed to fetch AI settings:', err);
    } finally {
      setAiSettingsLoading(false);
    }
  }, []);

  const saveAIApiKey = useCallback(async (key: string) => {
    setAiSettingsLoading(true);
    try {
      // Save to localStorage for client-side use (e.g., document import)
      setOpenRouterApiKey(key);

      const { saveAISettings } = await getApiClient();
      const settings = await saveAISettings({ apiKey: key });
      setHasApiKey(settings.hasApiKey);
      setMaskedApiKey(settings.maskedApiKey);
    } catch (err) {
      console.error('Failed to save AI API key:', err);
      throw err;
    } finally {
      setAiSettingsLoading(false);
    }
  }, [setOpenRouterApiKey]);

  const saveAIModel = useCallback(async (model: string) => {
    setAiSettingsLoading(true);
    try {
      const { saveAISettings } = await getApiClient();
      const settings = await saveAISettings({ model });
      setAiModelRaw(settings.model);
      try { localStorage.setItem('aiModel', settings.model); } catch {}
    } catch (err) {
      console.error('Failed to save AI model:', err);
      throw err;
    } finally {
      setAiSettingsLoading(false);
    }
  }, []);

  const saveImportAiModel = useCallback(async (model: string) => {
    setImportAiModel(model);
    try {
      const { saveAISettings } = await getApiClient();
      await saveAISettings({ importModel: model });
    } catch (err) {
      console.error('Failed to save import AI model:', err);
      throw err;
    }
  }, [setImportAiModel]);

  const clearAIApiKey = useCallback(async () => {
    setAiSettingsLoading(true);
    try {
      const { clearAIKey } = await getApiClient();
      const settings = await clearAIKey();
      setHasApiKey(settings.hasApiKey);
      setMaskedApiKey(settings.maskedApiKey);
    } catch (err) {
      console.error('Failed to clear AI API key:', err);
      throw err;
    } finally {
      setAiSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAISettings();
  }, [refreshAISettings]);


  const resetToDemo = useCallback(() => {
    setActiveHostFilter('all');
    skipNextTicketSaveRef.current = true;
    setTickets(MOCK_TICKETS);
    // NOTE: kbEntries is now derived from knowledgeChunks + MOCK_KB seed;
    // resetting the chunk store wipes user-created entries. The seed
    // re-appears automatically via the derived memo.
    setKnowledgeChunks([]);
    setDarkModeRaw(false);
    setDevModeRaw(false);
    // Don't reset agent name — it comes from Supabase profile
    setDefaultLanguageRaw('en');
    setOpenRouterApiKeyRaw('');
    setAiModelRaw('openai/gpt-4o-mini');
    setNotifications([
      { id: 'n1', title: 'New Escalation', message: 'Elena Rodriguez - AC issue at Villa Azure escalated by AI', time: '2 min ago', read: false, type: 'ticket' },
      { id: 'n3', title: 'Knowledge Base Updated', message: 'Urban Stays Co. luggage policy was modified by Admin', time: '1 hr ago', read: true, type: 'system' },
    ]);
    const resetHostSettings = MOCK_HOSTS.map(h => makeDefaultHostSettings(h));
    setHostSettings(resetHostSettings);
    setProperties(MOCK_PROPERTIES);
    setOnboardingData(PREFILLED_ONBOARDING);
    setCustomFormSections({});
    setDraftRepliesState({});
    setAutoReplyPausedTickets({});
    setAutoReplyHandedOffState({});
    setAutoReplyProcessingState({});
    setFormTemplateRaw(STATIC_SECTIONS);
    setFormPhasesRaw(DEFAULT_PHASES);
    // Clear persisted data
    try {
      localStorage.removeItem('formTemplate');
      localStorage.removeItem('formPhases');
      localStorage.removeItem('openRouterApiKey');
      localStorage.removeItem('aiModel');
      localStorage.removeItem('autoReplyPausedTickets');
      localStorage.removeItem('autoReplyHandedOff');
      localStorage.removeItem('draftReplies');
      localStorage.removeItem('onboardingData');
    } catch {}
    // Clear AI debug log
    clearDebugEntries();
    // Clear persisted state from BE (including hostSettings so reload doesn't restore old values)
    getApiClient().then(({ savePreferences }) => {
      savePreferences({ ticketState: '', hostSettings: resetHostSettings, properties: MOCK_PROPERTIES }).catch(() => {});
    }).catch(() => {});
  }, []);

  // ─── Ticket persistence to BE ─────────────────────────────
  const ticketSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticketsLoadedRef = useRef(false);
  const skipNextTicketSaveRef = useRef(false);

  // Serialize only the mutable parts of tickets (messages + resolved IDs)
  const saveTicketState = useCallback((currentTickets: Ticket[]) => {
    if (ticketSaveTimeoutRef.current) clearTimeout(ticketSaveTimeoutRef.current);
    ticketSaveTimeoutRef.current = setTimeout(async () => {
      try {
        const mockIds = new Set(MOCK_TICKETS.map(mt => mt.id));
        const messages: Record<string, any[]> = {};
        for (const t of currentTickets) {
          messages[t.id] = t.messages;
        }
        const resolvedIds = MOCK_TICKETS
          .filter(mt => !currentTickets.find(ct => ct.id === mt.id))
          .map(mt => mt.id);
        // Persist custom (test) tickets separately — strip non-serializable fields
        const customTickets = currentTickets
          .filter(t => !mockIds.has(t.id))
          .map(({ channelIcon, ...rest }) => rest);
        const { savePreferences } = await getApiClient();
        await savePreferences({ ticketState: JSON.stringify({ messages, resolvedIds, customTickets }) });
      } catch (err) {
        console.error('Failed to persist ticket state:', err);
      }
    }, 500);
  }, []);

  // Save tickets whenever they change (after initial load)
  useEffect(() => {
    if (!ticketsLoadedRef.current) return;
    if (skipNextTicketSaveRef.current) {
      skipNextTicketSaveRef.current = false;
      return;
    }
    saveTicketState(tickets);
  }, [tickets, saveTicketState]);

  const createTestTicket = useCallback((opts: { hostId: string; propertyName: string; guestName: string; firstMessage: string }) => {
    const host = MOCK_HOSTS.find(h => h.id === opts.hostId) || MOCK_HOSTS[0];
    const prop = MOCK_PROPERTIES.find(p => p.name === opts.propertyName && p.hostId === host.id);
    const room = prop?.roomNames?.[0] || 'Entire Property';
    const ticketId = `t-${Date.now()}`;

    // Derive realistic tags + handover reason from the guest's first message
    const detected = detectInquiries([opts.firstMessage], [], '');
    const primaryInquiry = detected[0];

    // Build handover reason in the same style as mock data: "Category (Detail)"
    const HANDOVER_MAP: Record<string, string> = {
      maintenance: 'Maintenance Request',
      wifi: 'Wi-Fi Connectivity Issue',
      checkout: 'Schedule Change Request (Late Checkout)',
      checkin: 'Early Check-in / Access Inquiry',
      noise: 'Noise Complaint (Guest Report)',
      luggage: 'Complex Inquiry (Luggage)',
      directions: 'Pre-arrival Inquiry (Transport)',
      billing: 'Billing / Refund Inquiry',
      amenities: 'Amenity Inquiry',
      pet: 'Pet Policy Inquiry',
      safety: 'Safety / Emergency Concern',
    };

    let handoverReason: string;
    let tags: string[];
    let summary: string;
    let status: 'normal' | 'urgent' | 'warning' = 'normal';

    if (primaryInquiry && primaryInquiry.type !== 'general') {
      handoverReason = HANDOVER_MAP[primaryInquiry.type] || `${primaryInquiry.label}`;
      // Append detail if it adds context
      if (primaryInquiry.detail && !handoverReason.includes(primaryInquiry.detail)) {
        const shortDetail = primaryInquiry.detail.length > 40
          ? primaryInquiry.detail.slice(0, 37) + '...'
          : primaryInquiry.detail;
        handoverReason += ` — ${shortDetail}`;
      }
      // Use the inquiry's tags directly
      tags = [...new Set(primaryInquiry.relevantTags)];
      // If multiple inquiries detected, note that
      if (detected.length > 1) {
        handoverReason = `Multi-topic: ${detected.map(d => d.label.split(' ')[0]).join(' + ')}`;
        tags = [...new Set(detected.flatMap(d => d.relevantTags))];
      }
      summary = `${opts.guestName}: ${primaryInquiry.detail}`;
      // Escalate maintenance, safety, and noise
      if (['maintenance', 'safety'].includes(primaryInquiry.type)) {
        status = 'urgent';
        if (!tags.includes('High Priority')) tags.push('High Priority');
      } else if (['noise', 'billing'].includes(primaryInquiry.type)) {
        status = 'warning';
      }
    } else {
      // General / unclassifiable — still give it a reasonable handover
      handoverReason = 'Guest Inquiry (Needs Review)';
      tags = ['Needs Review'];
      summary = `${opts.guestName} sent a message that needs agent review.`;
    }

    const newTicket: Ticket = {
      id: ticketId,
      guestName: opts.guestName,
      channel: 'Direct',
      channelIcon: MessageSquare,
      host,
      property: opts.propertyName,
      room,
      status,
      sla: status === 'urgent' ? '04:00' : status === 'warning' ? '12:00' : '24:00',
      aiHandoverReason: handoverReason,
      summary,
      tags,
      language: 'English',
      messages: [
        {
          id: 1,
          sender: 'guest' as const,
          text: opts.firstMessage,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          createdAt: Date.now(),
        },
      ],
      booking: { checkIn: 'Today', checkOut: 'Tomorrow', guests: 2, status: 'Checked In' },
    };
    setTickets(prev => [newTicket, ...prev]);
    return ticketId;
  }, []);

  const resumeAllAI = useCallback(() => {
    // Preserve locked threads; clear unlocked thread overrides
    setAutoReplyPausedTickets(prev => {
      const next: Record<string, boolean> = {};
      for (const [id, val] of Object.entries(prev)) {
        if (threadAiLocks[id]) next[id] = val;
      }
      syncPrefToBackend('autoReplyPausedTickets', next);
      return next;
    });
    // Must explicitly set each unlocked ticket to `false` so that
    // the `=== false` override check in InboxView/useAutoReply prevents
    // system-message-derived "handed off" status from re-asserting.
    setAutoReplyHandedOffState(prev => {
      const next = { ...prev };
      for (const t of tickets) {
        if (!threadAiLocks[t.id]) next[t.id] = false;
      }
      return next;
    });
  }, [tickets, threadAiLocks, syncPrefToBackend]);

  return (
    <AppContext.Provider value={{
      activeHostFilter, setActiveHostFilter,
      tickets, setTickets, activeMessages, setActiveMessages,
      isInitialLoad, proxyCompanyIds, setProxyTicketProperty,
      firestoreConnections, firestoreInitializing,
      addFirestoreConnection, removeFirestoreConnection, reconnectFirestore, markFirestoreConnectionExpired,
      getFirestoreToken,
      classifyCache,
      escalationOverrides, handoverReasons, setHandoverReason,
      resolveTicket, addMessageToTicket, pendingProxyMessages, retryPendingProxyMessage, deletePendingProxyMessage, injectGuestMessage, addBotMessage, addSystemMessage, addMultipleMessages, escalateTicketStatus, escalateTicketWithUrgency, deescalateTicket, deleteMessageFromTicket, deleteThread,
      draftReplies, setDraftReply, clearDraftReply,
      ticketNotes, updateTicketNotes,
      kbEntries, addKBEntry, updateKBEntry, deleteKBEntry, deleteKBEntriesBySource,
      knowledgeChunks, upsertKnowledgeChunks, updateKnowledgeChunk, deleteKnowledgeChunks,
      ingestedDocuments, upsertIngestedDocument, deleteIngestedDocument,
      properties, addProperty, updatePropertyStatus, updatePropertyMeta, deleteProperty,
      onboardingData, setOnboardingField, setOnboardingBulk,
      formPersistStatus, manualSyncFormData,
      customFormSections, addCustomFormSection, removeCustomFormSection, renameCustomFormSection,
      notifications, markNotificationRead, markAllNotificationsRead, unreadCount,
      hostSettings, updateHostSettings,
      agentPresence, setAgentPresence,
      aiKillSwitchEnabled, setAiKillSwitchEnabled,
      autoAwayMinutes, setAutoAwayMinutes,
      darkMode, setDarkMode,
      devMode: devModeRaw, setDevMode,
      agentName: agentNameRaw, setAgentName,
      defaultLanguage: defaultLanguageRaw, setDefaultLanguage,
      openRouterApiKey, setOpenRouterApiKey,
      aiModel, setAiModel,
      importAiModel, setImportAiModel,
      formTemplate, updateFormSection, addFormSection, removeFormSection, reorderFormSections,
      updateFormField, addFormField, removeFormField, reorderFormFields,
      resetFormTemplate,
      formPhases, addFormPhase, updateFormPhase, removeFormPhase, reorderFormPhases,
      resetFormPhases,
      aiSettingsLoading,
      hasApiKey,
      maskedApiKey,
      saveAIApiKey,
      saveAIModel,
      saveImportAiModel,
      clearAIApiKey,
      refreshAISettings,
      resetToDemo,
      createTestTicket,
      notificationPrefs, updateNotificationPrefs,
      promptOverrides, updatePromptOverride, resetPromptOverride,
      autoReplyProcessing, setAutoReplyProcessing,
      autoReplyCancelledRef,
      autoReplyAbortControllers,
      cancelAutoReply,
      autoReplyPausedTickets, toggleAutoReplyPause, setTicketAiEnabled,
      autoReplyHandedOff, setAutoReplyHandedOff,
      resumeAllAI,
      threadAiLocks, toggleThreadAiLock,
      firestoreSyncedTickets,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}
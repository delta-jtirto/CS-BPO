/**
 * useGlobalAutoReply — Global listener that watches ALL tickets for new guest
 * messages and automatically generates AI responses when the host has
 * "Automatic Replies" enabled and an API key is configured.
 *
 * EIGHT IMPROVEMENTS over the original per-ticket hook:
 * 1. Partial Coverage — answers covered inquiries + acknowledges uncovered
 * 2. Debounce Window (30s) — waits for guest to finish typing before replying
 * 3. Don't-Double-Hold Guard — won't re-send holding msgs for same topics
 * 4. Global Listener — watches all tickets, not just the active one
 * 5. Channel-Aware Tone — adapts message style to Airbnb/Booking.com/etc.
 * 6. Escalation Urgency Tiers — maps inquiry types to urgency levels + SLAs
 * 7. Re-Escalation Timer — bumps to urgent if agent doesn't respond within 30min
 * 8. Response Mode Config — supports auto/draft/assist per host
 *
 * ROUTING OUTCOMES (hospitality-friendly labels):
 * AI Handled:       Full KB coverage → AI composes helpful reply using matched facts
 * Handed to Agent:  Zero KB coverage → AI sends warm holding message, routes to team
 * Partially Answered: Some coverage → AI answers covered parts, routes the rest
 *
 * POST-REPLY COHERENCE CHECK:
 * After Track 1 AI composes a reply, we scan the text for holding/deferral
 * patterns. If the AI "punted" despite having KB matches (vague entries),
 * we reclassify as Handed to Agent to avoid the green "AI Handled" banner
 * appearing above a holding message.
 */

import { useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { useAppContext } from '../../context/AppContext';
import { composeReplyAI } from '../../ai/api-client';
import { interpolate, resolvePrompt, resolveModel, resolveTemperature, resolveMaxTokens } from '../../ai/prompts';
import type { PromptOverrides } from '../../ai/prompts';
import { buildPropertyContext } from '../../ai/kb-context';
import type { Ticket } from '../../data/types';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { mapFirestoreMessage, type FirestoreMessage } from '../../../lib/firestore-mappers';

// ─── Debounce presets (ms) — configurable per host ───────────────
const DEBOUNCE_PRESETS: Record<string, number> = {
  instant: 2_000,  // 2 seconds — fire ASAP (small buffer for typos)
  quick: 10_000,   // 10 seconds — SMS/chat
  normal: 30_000,  // 30 seconds — default
  patient: 60_000, // 60 seconds — email-style
};

// ─── Re-escalation timer (ms) — bumps to urgent if no agent reply ─
const RE_ESCALATION_MS = 30 * 60_000; // 30 minutes

// ─── Channel-Aware Tone Hints ────────────────────────────────────
const CHANNEL_TONE: Record<string, string> = {
  'Airbnb': 'Warm and personal — Airbnb guests expect a friendly, host-like tone. Keep it conversational, 2-3 sentences.',
  'Booking.com': 'Professional and concise — Booking.com guests expect efficient, hotel-style communication. Keep it to 1-2 sentences.',
  'VRBO': 'Friendly and informative — VRBO guests are often families, keep it welcoming and clear.',
  'WhatsApp': 'Casual and brief — this is a chat channel, keep messages short and informal, 1-2 sentences max.',
  'SMS': 'Very brief — SMS has character limits, be extremely concise in 1 sentence.',
  'Email': 'Professional and thorough — email allows for more detail, but stay warm.',
  'Direct': 'Warm and helpful — direct booking guests chose you specifically, make them feel valued.',
};

// ─── Inquiry-Type → Urgency Mapping ──────────────────────────────
const URGENCY_MAP: Record<string, { level: 'urgent' | 'warning'; sla: string }> = {
  maintenance:  { level: 'urgent',  sla: '2h' },
  safety:       { level: 'urgent',  sla: '1h' },
  houserules:   { level: 'warning', sla: '4h' },
  noise:        { level: 'warning', sla: '4h' },
  billing:      { level: 'warning', sla: '6h' },
  complaint:    { level: 'warning', sla: '4h' },
  // Everything else defaults to { level: 'warning', sla: '12h' }
};

/**
 * Return a stable fingerprint for the last guest message in a list.
 * Identical fingerprint = same message arriving again (Firestore re-subscription,
 * page-navigation re-render, etc.) → no auto-reply re-trigger.
 */
function lastGuestFingerprint(messages: import('../../data/types').Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.sender === 'guest') return `${m.createdAt}|${(m.text ?? '').slice(0, 100)}`;
  }
  return '';
}

function getUrgency(inquiries: DetectedInquiry[]): { level: 'warning' | 'urgent'; sla: string } {
  let highest: { level: 'warning' | 'urgent'; sla: string } = { level: 'warning', sla: '12h' };
  for (const inq of inquiries) {
    const u = URGENCY_MAP[inq.type];
    if (u && u.level === 'urgent') return u; // urgent is highest, return immediately
    if (u && highest.level !== 'urgent') {
      // Keep the tightest SLA
      const currentHours = parseInt(highest.sla);
      const newHours = parseInt(u.sla);
      if (newHours < currentHours) highest = u;
    }
  }
  return highest;
}

// ─── Track 1/2/3 constants kept for reference (replaced by AUTO_REPLY_SYSTEM) ─
// const TRACK1_SYSTEM = ...
// const TRACK2_SYSTEM = ...
// const TRACK3_SYSTEM = ...


// ─── AI Auto-Reply Output Schema ─────────────────────────────────

interface PromisedAction {
  action: 'dispatch_maintenance' | 'check_availability' | 'confirm_booking_detail' | 'contact_vendor' | 'custom';
  summary: string;
  urgency: 'normal' | 'high';
  confidence: number;
}

interface AIAutoReplyOutput {
  reply: string;
  outcome: 'answered' | 'partial' | 'escalate';
  escalate_topics: string[];
  risk_score: number;
  reason: string;
  /** Actions the AI promised in the reply that require human follow-up */
  promised_actions: PromisedAction[];
  /** True if the post-processing safety net detected a banned phrase (e.g. "right away") */
  safetyFlagged?: boolean;
}

/**
 * Base banned phrases that must never appear in auto-sent replies.
 * Combined at runtime with per-property guardrails.bannedPhrases (Phase 3).
 */
export const BASE_BANNED_PHRASES = [
  'right away',
  'immediately',
  'within the hour',
  "i've arranged",
  'i have arranged',
  'very soon',
  'at once',
];

/**
 * Build a regex that tests for any banned phrase, combining the base list
 * with optional property-level additions.
 */
export function buildBannedPhraseRegex(extraPhrases: string[] = []): RegExp {
  const all = [...BASE_BANNED_PHRASES, ...extraPhrases];
  const escaped = all.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('|'), 'i');
}

/**
 * Parse the AI's JSON response. Returns a safe fallback on any parse error.
 * Handles markdown code fences and validates promised_actions shape.
 */
function parseAIReplyOutput(text: string): AIAutoReplyOutput {
  const fallback: AIAutoReplyOutput = {
    reply: '',
    outcome: 'escalate',
    escalate_topics: [],
    risk_score: 10,
    reason: 'JSON parse failure — fallback to escalate',
    promised_actions: [],
  };
  try {
    // Strip markdown code fences that models sometimes wrap around JSON
    const stripped = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) {
      console.log('[AutoReply] JSON parse failure — no JSON block found. Raw:', text.slice(0, 200));
      return fallback;
    }
    const parsed = JSON.parse(match[0]);
    if (!parsed.reply || !parsed.outcome || !['answered', 'partial', 'escalate'].includes(parsed.outcome)) {
      console.log('[AutoReply] JSON parse failure — missing/invalid fields. Raw:', text.slice(0, 200));
      return fallback;
    }

    // Validate promised_actions — silently drop malformed entries
    let promised_actions: PromisedAction[] = [];
    if (Array.isArray(parsed.promised_actions)) {
      promised_actions = parsed.promised_actions
        .filter((a: unknown) =>
          a && typeof a === 'object' &&
          typeof (a as PromisedAction).summary === 'string' &&
          ['dispatch_maintenance','check_availability','confirm_booking_detail','contact_vendor','custom']
            .includes((a as PromisedAction).action) &&
          ['normal','high'].includes((a as PromisedAction).urgency)
        )
        .map((a: PromisedAction) => ({
          action: a.action,
          summary: String(a.summary).slice(0, 200), // cap length
          urgency: a.urgency,
          confidence: typeof a.confidence === 'number'
            ? Math.max(0, Math.min(1, a.confidence))
            : 0.5,
        }));
    }

    return {
      reply: String(parsed.reply),
      outcome: parsed.outcome as 'answered' | 'partial' | 'escalate',
      escalate_topics: Array.isArray(parsed.escalate_topics) ? parsed.escalate_topics.map(String) : [],
      risk_score: typeof parsed.risk_score === 'number' ? parsed.risk_score : 5,
      reason: parsed.reason ? String(parsed.reason) : '',
      promised_actions,
    };
  } catch {
    console.log('[AutoReply] JSON parse failure. Raw:', text.slice(0, 200));
    return fallback;
  }
}

/**
 * Map escalated topic keywords to an urgency level.
 * Replaces inquiry-type-based URGENCY_MAP for the single-call flow.
 */
function topicsToUrgency(topics: string[]): 'urgent' | 'warning' | 'normal' {
  const joined = topics.join(' ');
  if (/(fire|gas|flood|emergency|medical|injury|break.?in)/i.test(joined)) return 'urgent';
  if (/(noise|billing|complaint|refund|damage)/i.test(joined)) return 'warning';
  return 'normal';
}

/**
 * Build the system + user prompt pair for a single auto-reply AI call.
 */
function buildAutoReplyPrompt(
  ticket: Ticket, guestMessage: string, kbContext: string,
  hostTone: string, conversationHistory: string, channelHint: string,
  overrides: PromptOverrides = {},
): { system: string; user: string } {
  const guestFirstName = ticket.guestName.split(' ')[0];
  const historyBlock = conversationHistory
    ? `Recent conversation:\n${conversationHistory}\n\n`
    : '';
  return {
    system: resolvePrompt('auto_reply', 'system', overrides),
    user: interpolate(resolvePrompt('auto_reply', 'user', overrides), {
      hostName: ticket.host.name,
      hostTone,
      channel: ticket.channel,
      channelHint,
      guestFirstName,
      propertyName: ticket.property,
      roomName: ticket.room || 'N/A',
      conversationHistory: historyBlock,
      guestMessage,
      kbContext,
    }),
  };
}

function buildConversationHistory(ticket: Ticket): string {
  // Exclude system messages — they are internal routing notes, not conversation content.
  // Feeding them to the AI pollutes tone assessment and confuses context.
  // Expanded from 10 to 20 messages for better context depth.
  const recentMessages = (ticket.messages || [])
    .filter(m => m.sender !== 'system')
    .slice(-20);

  if (recentMessages.length === 0) return 'Recent conversation (TOON format):\nconversation[0]:';

  // TOON format: conversation[N]{sender,text}: then N rows
  const header = `Recent conversation (TOON format):
conversation[${recentMessages.length}]{sender,text}:`;
  const rows = recentMessages.map(m => {
    // Map sender to TOON label, escape newlines and quotes
    const senderLabel = m.sender === 'guest' ? 'guest'
      : m.sender === 'bot' ? 'ai'
      : m.sender === 'host' ? 'host'
      : 'agent';
    const escaped = m.text.replace(/\n/g, ' ').replace(/"/g, '\\"');
    return `  ${senderLabel},"${escaped}"`;
  });

  return [header, ...rows].join('\n');
}

// ─── Exported Global Hook ────────────────────────────────────────

export function useGlobalAutoReply() {
  // Use a try/catch to gracefully handle HMR context identity mismatches
  // where AppContext recreates during hot module replacement
  let ctx: ReturnType<typeof useAppContext> | null = null;
  try {
    ctx = useAppContext();
  } catch {
    // Context not available (HMR transition) — will no-op this render cycle
  }

  const tickets = ctx?.tickets ?? [];
  const hostSettings = ctx?.hostSettings ?? [];
  const kbEntries = ctx?.kbEntries ?? [];
  const properties = ctx?.properties ?? [];
  const onboardingData = ctx?.onboardingData ?? {};
  const formTemplate = ctx?.formTemplate ?? [];
  const hasApiKey = ctx?.hasApiKey ?? false;
  const aiModel = ctx?.aiModel ?? '';
  const promptOverrides = ctx?.promptOverrides ?? {};
  const addBotMessage = ctx?.addBotMessage ?? (() => {});
  const addSystemMessage = ctx?.addSystemMessage ?? (() => {});
  const addMultipleMessages = ctx?.addMultipleMessages ?? (() => {});
  const escalateTicketStatus = ctx?.escalateTicketStatus ?? (() => {});
  const escalateTicketWithUrgency = ctx?.escalateTicketWithUrgency ?? (() => {});
  const setDraftReply = ctx?.setDraftReply ?? (() => {});
  const notificationPrefs = ctx?.notificationPrefs ?? { notifyAutoReply: true, notifyEscalation: true, notifyDraft: true, emailAlerts: true, soundAlerts: true, escalationAlerts: true };
  const setAutoReplyProcessing = ctx?.setAutoReplyProcessing ?? (() => {});
  const autoReplyCancelledRef = ctx?.autoReplyCancelledRef ?? { current: {} };
  const autoReplyAbortControllers = ctx?.autoReplyAbortControllers ?? { current: {} };
  const autoReplyPausedTickets = ctx?.autoReplyPausedTickets ?? {};
  const autoReplyHandedOff = ctx?.autoReplyHandedOff ?? {};
  const setAutoReplyHandedOff = ctx?.setAutoReplyHandedOff ?? (() => {});
  const cancelAutoReply = ctx?.cancelAutoReply ?? (() => {});
  const firestoreConnections = ctx?.firestoreConnections ?? [];
  const agentPresence = ctx?.agentPresence ?? 'away'; // default 'away' so existing behavior is preserved if context unavailable

  // Track last processed guest message fingerprint per ticket.
  // Fingerprint = `${createdAt}|${text.slice(0,100)}` of the last guest message.
  // Using a fingerprint instead of a count makes new-message detection idempotent:
  // the same message arriving twice (Firestore re-subscription, nav back, F5) is a no-op.
  const lastGuestMsgRef = useRef<Record<string, string>>({});
  // Track unread counts — used to detect new messages on background Firestore threads
  // (where ticket.messages is not loaded until the thread is opened)
  const prevUnreadCountsRef = useRef<Record<string, number>>({});
  // Debounce timers per ticket
  const debounceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Pending processing flag per ticket
  const pendingRef = useRef<Record<string, boolean>>({});
  // Already-escalated inquiry types per ticket (don't-double-hold guard)
  const escalatedTypesRef = useRef<Record<string, Set<string>>>({});
  // Re-escalation timers per ticket
  const reEscalationTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Track which tickets had their counts initialized
  const initializedRef = useRef<Set<string>>(new Set());
  // Timestamp of hook mount — tickets appearing after this are "new" and should be processed
  const mountTimeRef = useRef(Date.now());
  // Latest tickets ref for re-escalation timer (avoids stale closure)
  const ticketsRef = useRef(tickets);
  ticketsRef.current = tickets;

  // Build AI context for a ticket directly from form data + manual KB entries
  const buildKBContext = useCallback((ticket: Ticket): string => {
    const prop = properties.find(p => p.name === ticket.property);
    const roomNames = prop?.roomNames ?? (prop?.units === 1 ? ['Entire Property'] : Array.from({ length: prop?.units ?? 1 }, (_, i) => `Unit ${i + 1}`));
    const manualEntries = kbEntries.filter(kb => kb.hostId === ticket.host.id && (!kb.propId || kb.propId === prop?.id));
    return buildPropertyContext(prop?.id ?? '', ticket.property, onboardingData, formTemplate, roomNames, manualEntries);
  }, [kbEntries, properties, onboardingData, formTemplate]);

  // ─── Re-escalation timer (defined before processTicket so it can be referenced) ─
  const startReEscalationTimer = useCallback((ticketId: string) => {
    // Clear any existing timer
    if (reEscalationTimersRef.current[ticketId]) {
      clearTimeout(reEscalationTimersRef.current[ticketId]);
    }

    reEscalationTimersRef.current[ticketId] = setTimeout(() => {
      // Check if agent has responded (use ref for latest state)
      const ticket = ticketsRef.current.find(t => t.id === ticketId);
      if (!ticket) return;

      const recentHuman = (ticket.messages || []).slice(-10).some(
        m => m.sender === 'agent' || m.sender === 'host'
      );

      if (!recentHuman && ticket.status !== 'urgent') {
        console.log('[AutoReply] Re-escalation: no agent response for %s — bumping to urgent', ticketId);
        escalateTicketWithUrgency(ticketId, 'urgent', '1h');
        addSystemMessage(
          ticketId,
          'No reply in 30 min — escalated to urgent'
        );
        toast.error(`URGENT: ${ticket.guestName}`, {
          description: 'No agent response in 30 min — re-escalated to urgent priority.',
          duration: 10000,
        });
      }
    }, RE_ESCALATION_MS);
  }, [escalateTicketWithUrgency, addSystemMessage]);

  // ─── Process a ticket (called after debounce) ──────────────────
  const processTicket = useCallback(async (ticketId: string) => {
    // Find the ticket in the latest state
    let ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) {
      setAutoReplyProcessing(ticketId, false);
      return;
    }

    // For proxy tickets, messages live in Supabase and aren't stored in
    // ticket.messages (to avoid feedback loops with the main detection effect).
    // Fetch them now for the AI to work with.
    if (ticket.proxyConversationId && (!ticket.messages || ticket.messages.length === 0)) {
      try {
        const { supabase } = await import('@/lib/supabase-client');
        const { mapProxyMessageToMessage } = await import('@/lib/proxy-mappers');
        const { data } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', ticket.proxyConversationId)
          .order('channel_timestamp', { ascending: true });
        if (data && data.length > 0) {
          const fetchedMsgs = data.map((m: any) => mapProxyMessageToMessage(m));
          // Merge with any local bot/system messages
          const localMsgs = (ticket.messages || []).filter(
            m => m.sender === 'bot' || m.sender === 'system'
          );
          ticket = { ...ticket, messages: [...fetchedMsgs, ...localMsgs].sort((a, b) => a.createdAt - b.createdAt) };
          console.log('[AutoReply] Fetched %d proxy messages for ticket %s', fetchedMsgs.length, ticketId);
        }
      } catch (err) {
        console.error('[AutoReply] Failed to fetch proxy messages for %s:', ticketId, err);
      }
    }

    // For Firestore background threads, messages aren't loaded — fetch them now so
    // the AI has conversation history to work with.
    if (ticket.firestoreThreadId && (!ticket.messages || ticket.messages.length === 0)) {
      const conn = firestoreConnections.find(
        c => c.hostId === ticket!.firestoreHostId && c.status === 'connected' && c.db,
      );
      if (conn?.db) {
        try {
          const msgsSnap = await getDocs(query(
            collection(conn.db, 'threads', ticket.firestoreThreadId, 'messages'),
            orderBy('timestamp', 'asc'),
          ));
          const fetchedMsgs = msgsSnap.docs.map(d =>
            mapFirestoreMessage(
              { message_id: d.id, ...d.data() } as FirestoreMessage,
              ticket!.firestoreGuestUserId,
            )
          );
          if (fetchedMsgs.length > 0) {
            ticket = { ...ticket, messages: fetchedMsgs };
            console.log('[AutoReply] Fetched %d Firestore messages for background ticket %s',
              fetchedMsgs.length, ticketId);
          }
        } catch (err) {
          console.error('[AutoReply] Failed to fetch Firestore messages for %s:', ticketId, err);
        }
      }
    }

    // ─── Idempotency: already-replied check ──────────────────────────
    // Skip if ANY outbound message (bot / agent / host) has been sent after
    // the most recent guest message. Handles every duplicate-fire path:
    //   * Page refresh — sessionStorage fingerprints cleared, but the prior
    //     reply is still in ticket.messages / Supabase
    //   * Realtime re-subscription or polling tick
    //   * A manual agent reply landing between guest msg and AI debounce
    // Runs AFTER the fresh Supabase/Firestore fetch above so we're checking
    // the canonical conversation state, not stale local data.
    const allMsgs = ticket.messages || [];
    const latestGuestMsg = [...allMsgs].reverse().find(m => m.sender === 'guest');
    if (latestGuestMsg) {
      const replyExists = allMsgs.some(m =>
        (m.sender === 'bot' || m.sender === 'agent' || m.sender === 'host') &&
        (m.createdAt ?? 0) > (latestGuestMsg.createdAt ?? 0)
      );
      if (replyExists) {
        console.log('[AutoReply] %s: already replied to latest guest msg — skipping', ticketId);
        setAutoReplyProcessing(ticketId, false);
        pendingRef.current[ticketId] = false;
        return;
      }
    }

    const hostConfig = hostSettings.find(s => s.hostId === ticket.host.id);
    // Per-ticket explicit enable (autoReplyPausedTickets[id] === false) overrides host-level off.
    // This allows one thread to run AI even when the host's global switch is off.
    const isTicketExplicitlyEnabled = autoReplyPausedTickets[ticketId] === false;
    if (!hostConfig?.autoReply && !isTicketExplicitlyEnabled) {
      setAutoReplyProcessing(ticketId, false);
      return;
    }

    // Assist mode = no auto-reply, only sidebar powers
    if (hostConfig?.autoReplyMode === 'assist') {
      console.log('[AutoReply] %s: assist mode — skipping auto-reply', ticketId);
      setAutoReplyProcessing(ticketId, false);
      return;
    }

    // ─── Pause check — user paused AI for this thread ────────
    if (autoReplyPausedTickets[ticketId]) {
      console.log('[AutoReply] %s: AI paused for this thread — skipping', ticketId);
      setAutoReplyProcessing(ticketId, false);
      return;
    }

    // Note: handoff no longer disables AI — AI continues responding to new questions.
    // The "Your Turn" badge persists until the agent replies; duplicate holding messages
    // are suppressed (see escalate path below). This way guests get answers to topics
    // the AI CAN cover even after a previous escalation.

    if (pendingRef.current[ticketId]) {
      setAutoReplyProcessing(ticketId, false);
      return;
    }
    pendingRef.current[ticketId] = true;
    
    // Clear any prior cancellation and set processing state
    autoReplyCancelledRef.current[ticketId] = false;
    setAutoReplyProcessing(ticketId, true);

    // Create an AbortController for this ticket's AI request(s)
    // so cancelAutoReply() can abort in-flight HTTP calls
    const abortController = new AbortController();
    autoReplyAbortControllers.current[ticketId] = abortController;
    const signal = abortController.signal;

    try {
      // ─── Safety keyword check (P0) ─────────────────────────
      const safetyKeywords = hostConfig.safetyKeywords || [];
      if (safetyKeywords.length > 0) {
        // Dedup: only fire the safety alert once per thread (don't re-add on every new message)
        const alreadySafety = (ticket.messages || []).some(
          m => m.sender === 'system' && m.text.toLowerCase().startsWith('safety alert')
        );
        if (!alreadySafety) {
          // Scan ALL guest messages in the thread — a safety keyword anywhere should escalate
          const allGuestMsgs = (ticket.messages || []).filter(m => m.sender === 'guest');
          const guestText = allGuestMsgs.map(m => m.text).join(' ').toLowerCase();
          const triggeredKeywords = safetyKeywords.filter(kw => {
            const escaped = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`\\b${escaped}\\b`, 'i').test(guestText);
          });
          if (triggeredKeywords.length > 0) {
            console.log('[AutoReply] SAFETY TRIGGER on %s: keywords [%s] — forcing escalation',
              ticketId, triggeredKeywords.join(', '));
            addSystemMessage(
              ticketId,
              `Safety Alert — Keywords: ${triggeredKeywords.join(', ')}`
            );
            escalateTicketWithUrgency(ticketId, 'urgent', '1h');
            toast.error(`Safety alert: ${ticket.guestName}`, {
              description: `Flagged keywords detected: ${triggeredKeywords.join(', ')}. Manual response required.`,
              duration: 10000,
            });
            startReEscalationTimer(ticketId);
            return;
          }
        }
      }

      // ─── Cooldown check — pause AI after agent reply (#1) ──
      if (hostConfig.cooldownEnabled && (hostConfig.cooldownMinutes || 10) > 0) {
        const cooldownMs = (hostConfig.cooldownMinutes || 10) * 60_000;
        const recentAgentMsg = [...(ticket.messages || [])].reverse().find(m => m.sender === 'agent' || m.sender === 'host');
        if (recentAgentMsg && recentAgentMsg.createdAt) {
          const elapsed = Date.now() - recentAgentMsg.createdAt;
          if (elapsed < cooldownMs) {
            console.log('[AutoReply] %s: cooldown active — agent replied %ds ago (cooldown=%dm), skipping',
              ticketId, Math.round(elapsed / 1000), hostConfig.cooldownMinutes || 10);
            return;
          }
        }
      }

      // ─── [STEP 3] Transactional Override (pre-AI, no exceptions) ─
      // Skip if already handed off — ticket is already escalated, no need to re-trigger
      if (autoReplyHandedOff[ticketId] !== true) {
        const TRANSACTIONAL_PATTERNS = [
          /\b(refund|compensat|reimburse)\b/i,
          /\b(cancel|modify).{0,30}(booking|reservation|stay)\b/i,
          /\b(lawyer|sue|legal action|chargeback)\b/i,
        ];
        const allGuestTextForTransactional = (ticket.messages || [])
          .filter(m => m.sender === 'guest').map(m => m.text).join(' ');
        if (TRANSACTIONAL_PATTERNS.some(p => p.test(allGuestTextForTransactional))) {
          console.log('[AutoReply] TRANSACTIONAL OVERRIDE on %s — escalating immediately', ticketId);
          addSystemMessage(
            ticketId,
            'Routed to team — Legal or financial request'
          );
          escalateTicketWithUrgency(ticketId, 'warning', '4h');
          setAutoReplyHandedOff(ticketId, true);
          if (notificationPrefs.notifyEscalation) {
            toast.warning(`Escalated: ${ticket.guestName}`, {
              description: 'Transactional request detected — agent required.',
              duration: 8000,
            });
          }
          startReEscalationTimer(ticketId);
          return;
        }
      }

      // ─── [STEP 4] Single AI Call with Full KB ─────────────────
      const lastGuestMsg = [...(ticket.messages || [])].reverse().find(m => m.sender === 'guest');
      if (!lastGuestMsg) return;

      const kbContext = buildKBContext(ticket);
      const channelHint = CHANNEL_TONE[ticket.channel] || CHANNEL_TONE['Direct']!;
      const conversationHistory = buildConversationHistory(ticket);
      const isDraft = hostConfig.autoReplyMode === 'draft';

      const { system: autoReplySystem, user: autoReplyUser } = buildAutoReplyPrompt(
        ticket, lastGuestMsg.text, kbContext,
        hostConfig.tone, conversationHistory, channelHint,
        promptOverrides,
      );

      console.log('[AutoReply] Single AI call for %s — context len: %d chars', ticketId, kbContext.length);

      const result = await composeReplyAI({
        systemPrompt: autoReplySystem,
        userPrompt: autoReplyUser,
        model: resolveModel('auto_reply', promptOverrides),
        temperature: resolveTemperature('auto_reply', promptOverrides),
        maxTokens: resolveMaxTokens('auto_reply', promptOverrides),
        signal,
      });

      // ─── Cancellation check after AI call ─────────────────────
      if (autoReplyCancelledRef.current[ticketId]) {
        console.log('[AutoReply] Cancelled after AI response for %s — discarding result', ticketId);
        return;
      }

      const output = parseAIReplyOutput(result.text);
      console.log('[AutoReply] AI output for %s: outcome=%s, risk=%d, topics=[%s], actions=%d',
        ticketId, output.outcome, output.risk_score, output.escalate_topics.join(', '), output.promised_actions.length);

      // ─── [STEP 5] Post-processing safety net ─────────────────────
      // Detect banned time-commitment phrases in the AI reply even when the
      // prompt instructions are followed imperfectly (LLMs are probabilistic).
      // Phase 3 will extend this with per-property guardrails.bannedPhrases.
      const bannedPhraseRegex = buildBannedPhraseRegex(/* extraPhrases from PropertyAISettings go here in Phase 3 */);
      if (bannedPhraseRegex.test(output.reply)) {
        console.log('[AutoReply] SAFETY FLAG: banned phrase detected in reply for %s — forcing draft mode', ticketId);
        output.safetyFlagged = true;
      }

      // ─── [STEP 5b] Risk Gate ──────────────────────────────────────
      if (output.risk_score >= 8) {
        console.log('[AutoReply] RISK GATE: score=%d — overriding outcome to escalate for %s', output.risk_score, ticketId);
        output.outcome = 'escalate';
      }

      // ─── [STEP 6] Route by Outcome + Host Settings ─────────────
      // Safety-flagged replies are always forced into draft regardless of autoReplyMode,
      // so the operator can review before sending.
      const effectiveIsDraft = isDraft || output.safetyFlagged === true;

      const outcomeForRouting = (output.outcome === 'partial' && hostConfig.partialCoverage === 'escalate-all')
        ? 'escalate'
        : output.outcome;

      if (outcomeForRouting === 'answered') {
        if (effectiveIsDraft) {
          setDraftReply(ticketId, output.reply);
          if (output.safetyFlagged) {
            // Add a visible internal note explaining the flag
            addSystemMessage(ticketId, 'AI Safety: time commitment phrase detected — review before sending');
          }
          if (notificationPrefs.notifyDraft) {
            toast.info(`AI Draft: ${ticket.guestName}`, {
              description: 'AI composed a reply. Review in the compose box.',
              duration: 6000,
            });
          }
        } else {
          // Only the bot reply — no system message needed. The bot bubble is self-evident.
          // Thread status badge handles showing "Resolved" in the sidebar.
          addMultipleMessages(ticketId, [
            { sender: 'bot', text: output.reply },
          ]);
          if (notificationPrefs.notifyAutoReply) {
            toast.success(`AI replied: ${ticket.guestName}`, {
              description: 'Auto-reply sent.',
            });
          }
        }

      } else if (outcomeForRouting === 'partial') {
        const topicList = output.escalate_topics.join(', ') || 'some topics';
        if (effectiveIsDraft) {
          setDraftReply(ticketId, output.reply);
          if (output.safetyFlagged) {
            addSystemMessage(ticketId, 'AI Safety: time commitment phrase detected — review before sending');
          }
          if (notificationPrefs.notifyDraft) {
            toast.info(`AI Draft: ${ticket.guestName}`, {
              description: `Partial coverage — review before sending. Uncovered: ${topicList}`,
              duration: 8000,
            });
          }
        } else {
          addMultipleMessages(ticketId, [
            { sender: 'bot', text: output.reply },
            { sender: 'system', text: `Follow-up needed — ${topicList}` },
          ]);
          const urgencyLevel = topicsToUrgency(output.escalate_topics);
          if (urgencyLevel !== 'normal') {
            escalateTicketWithUrgency(ticketId, urgencyLevel, urgencyLevel === 'urgent' ? '1h' : '4h');
          }
          if (notificationPrefs.notifyEscalation) {
            toast.warning(`Partial: ${ticket.guestName}`, {
              description: `AI answered some topics. Needs manual follow-up: ${topicList}`,
              duration: 8000,
            });
          }
          startReEscalationTimer(ticketId);
        }

      } else {
        // escalate
        const topicList = output.escalate_topics.join(', ') || 'guest inquiry';
        const isSilent = hostConfig.zeroCoverage === 'silent-escalate';
        // If already handed off, suppress the guest-facing holding message to avoid
        // repeating "someone will be in touch" — just add a quiet agent-visible note instead.
        const alreadyHandedOff = autoReplyHandedOff[ticketId] === true;

        if (effectiveIsDraft) {
          if (output.reply) setDraftReply(ticketId, output.reply);
          if (output.safetyFlagged) {
            addSystemMessage(ticketId, 'AI Safety: time commitment phrase detected — review before sending');
          }
          if (notificationPrefs.notifyDraft) {
            toast.info(`AI Draft: ${ticket.guestName}`, {
              description: 'Escalating — review holding message.',
              duration: 8000,
            });
          }
        } else if (alreadyHandedOff) {
          // Ticket already in agent hands — add internal note.
          // Also send a brief guest acknowledgment for real needs (not pleasantries)
          // so the guest isn't ghosted while waiting for the agent.
          addSystemMessage(ticketId, `AI Note — ${topicList}`);
          const isPleasantry = /^(hi|hello|hey|thanks|thank you|ok|okay|sure|sounds good|great|no worries|got it|perfect)[\s!?.]*$/i
            .test(lastGuestMsg.text.trim());
          if (!isPleasantry && !isSilent) {
            const botReply = output.reply || `Hi ${ticket.guestName.split(' ')[0]}, I've noted this and passed it to our team — they'll follow up with you shortly.`;
            addBotMessage(ticketId, botReply);
          }
          // Re-bump urgency if topics are serious
          const urgencyLevel = topicsToUrgency(output.escalate_topics);
          if (urgencyLevel !== 'normal') {
            escalateTicketWithUrgency(ticketId, urgencyLevel, urgencyLevel === 'urgent' ? '1h' : '4h');
          }
        } else {
          if (isSilent) {
            addSystemMessage(
              ticketId,
              `Silently routed — Not covered: ${topicList}`
            );
          } else {
            const botReply = output.reply || `Hi ${ticket.guestName.split(' ')[0]}, I've noted this and passed it to our team — they'll follow up with you shortly.`;
            addMultipleMessages(ticketId, [
              { sender: 'bot', text: botReply },
              { sender: 'system', text: `Routed to team — Not covered: ${topicList}` },
            ]);
          }
          setAutoReplyHandedOff(ticketId, true);
          const urgencyLevel = topicsToUrgency(output.escalate_topics);
          escalateTicketWithUrgency(ticketId, urgencyLevel === 'normal' ? 'warning' : urgencyLevel, urgencyLevel === 'urgent' ? '1h' : urgencyLevel === 'warning' ? '4h' : '12h');
          if (notificationPrefs.notifyEscalation) {
            toast.warning(`Escalated: ${ticket.guestName}`, {
              description: isSilent
                ? `Routed to agent (no guest message): ${topicList}`
                : `Holding message sent — manual reply needed: ${topicList}`,
              duration: 8000,
            });
          }
          startReEscalationTimer(ticketId);
        }
      }


      // ─── [STEP 7] Safety Flag Toast ────────────────────────────
      // Shown after routing so it doesn't interfere with routing toasts.
      if (output.safetyFlagged) {
        toast.warning(`Review required: ${ticket.guestName}`, {
          description: 'AI reply held — time commitment phrase detected. Check draft before sending.',
          duration: 8000,
        });
      }

    } catch (err) {
      // AbortError is expected when the user cancels — don't show error toast
      if ((err as any)?.name === 'AbortError') {
        console.log('[AutoReply] Request aborted for ticket %s (user cancelled)', ticketId);
      } else {
        console.error('[AutoReply] Failed for ticket %s:', ticketId, err);
        toast.error('Auto-reply failed', {
          description: `Could not process ${tickets.find(t => t.id === ticketId)?.guestName}'s message. Reply manually.`,
        });
      }
    } finally {
      pendingRef.current[ticketId] = false;
      setAutoReplyProcessing(ticketId, false);
      // Clean up the abort controller
      delete autoReplyAbortControllers.current[ticketId];
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, hostSettings, hasApiKey, aiModel, buildKBContext,
    addBotMessage, addSystemMessage, addMultipleMessages, escalateTicketStatus,
    escalateTicketWithUrgency, setDraftReply, startReEscalationTimer, notificationPrefs,
    autoReplyPausedTickets, autoReplyHandedOff, setAutoReplyHandedOff,
    setAutoReplyProcessing, autoReplyCancelledRef, autoReplyAbortControllers,
    firestoreConnections]);

  // ─── Main effect: watch all tickets for new guest messages ─────
  useEffect(() => {
    if (!hasApiKey) return;
    // When the agent is Online, AI auto-actions are suppressed — the agent handles
    // responses manually. Manual AI tools (compose, Ask AI) remain fully available.
    // When Away, AI acts autonomously per autoReplyMode.
    if (agentPresence === 'online') return;

    for (const ticket of tickets) {
      const hostConfig = hostSettings.find(s => s.hostId === ticket.host.id);
      const isExplicitlyEnabled = autoReplyPausedTickets[ticket.id] === false;
      if (!hostConfig?.autoReply && !isExplicitlyEnabled) continue;
      if (hostConfig?.autoReplyMode === 'assist') continue;

      const msgs = ticket.messages || [];
      const currentCount = msgs.length; // still used for background Firestore detection
      const currentFingerprint = lastGuestFingerprint(msgs);
      const currentUnread = ticket.unreadCount ?? 0;
      const prevUnread = prevUnreadCountsRef.current[ticket.id] ?? currentUnread;

      // ── Initialize on first encounter ──────────────────────────────────────
      if (!initializedRef.current.has(ticket.id)) {
        // Load the fingerprint of the last message that auto-reply already handled
        // (persisted to sessionStorage so page refresh doesn't re-trigger old messages)
        let savedFingerprint = '';
        try { savedFingerprint = sessionStorage.getItem(`ar:fp:${ticket.id}`) ?? ''; } catch {}

        // Baseline: prefer the saved fingerprint so we can detect truly-new messages
        // after a refresh. If no saved fingerprint, use current (don't replay history).
        lastGuestMsgRef.current[ticket.id] = savedFingerprint || currentFingerprint;
        prevUnreadCountsRef.current[ticket.id] = currentUnread;
        initializedRef.current.add(ticket.id);

        // Post-mount new ticket (e.g. createTestTicket, or a message that arrived while
        // the agent was away): trigger only if the last guest message wasn't already
        // processed before this page load.
        // Skip for proxy tickets — their messages load lazily via a sync effect, so
        // at init time we can't distinguish "old messages loading" from "genuinely new."
        // Proxy tickets detect new messages via the fingerprint block below once loaded.
        const isPostMount = Date.now() - mountTimeRef.current > 1500;
        if (isPostMount && !ticket.proxyConversationId && currentFingerprint !== '' && currentFingerprint !== savedFingerprint) {
          const ticketId = ticket.id;
          console.log('[AutoReply] New ticket %s post-mount with unprocessed guest message — processing', ticketId);
          if (debounceTimersRef.current[ticketId]) clearTimeout(debounceTimersRef.current[ticketId]);
          const debounceMs = DEBOUNCE_PRESETS[hostConfig.debouncePreset || 'normal'] || DEBOUNCE_PRESETS.normal;
          autoReplyCancelledRef.current[ticketId] = false;
          setAutoReplyProcessing(ticketId, true);
          debounceTimersRef.current[ticketId] = setTimeout(() => {
            if (autoReplyCancelledRef.current[ticketId]) { setAutoReplyProcessing(ticketId, false); return; }
            processTicket(ticketId);
          }, debounceMs);
        }
        continue;
      }

      // ── Proxy tickets: skip fingerprint detection ─────────────────────────
      // Proxy ticket messages are NOT stored in ticket.messages (doing so creates
      // feedback loops with this effect). Instead, proxy tickets use the unreadCount
      // path below. processTicket fetches messages directly from Supabase when needed.
      if (ticket.proxyConversationId) {
        // Fall through to unreadCount detection below
      } else {
        // ── Idempotent new-message detection via fingerprint ─────────────────
        // Different fingerprint = a genuinely new guest message.
        // Same fingerprint = same message arriving again (Firestore re-sub, nav-back, F5) → skip.
        const prevFingerprint = lastGuestMsgRef.current[ticket.id] ?? '';
        const hasNewGuestMsg = currentFingerprint !== '' && currentFingerprint !== prevFingerprint;

        if (hasNewGuestMsg) {
          lastGuestMsgRef.current[ticket.id] = currentFingerprint;
          try { sessionStorage.setItem(`ar:fp:${ticket.id}`, currentFingerprint); } catch {}

          const ticketId = ticket.id;

          if (autoReplyPausedTickets[ticketId]) {
            console.log('[AutoReply] New guest msg on %s but AI paused — ignoring', ticketId);
          } else {
            let cooledDown = false;
            if (hostConfig.cooldownEnabled && (hostConfig.cooldownMinutes || 10) > 0) {
              const cooldownMs = (hostConfig.cooldownMinutes || 10) * 60_000;
              const recentAgentMsg = [...msgs].reverse().find(m => m.sender === 'agent' || m.sender === 'host');
              if (recentAgentMsg?.createdAt && Date.now() - recentAgentMsg.createdAt < cooldownMs) {
                console.log('[AutoReply] New guest msg on %s but cooldown active (%dm) — ignoring',
                  ticketId, hostConfig.cooldownMinutes || 10);
                cooledDown = true;
              }
            }

            if (!cooledDown) {
              if (debounceTimersRef.current[ticket.id]) clearTimeout(debounceTimersRef.current[ticket.id]);
              const debounceMs = DEBOUNCE_PRESETS[hostConfig.debouncePreset || 'normal'] || DEBOUNCE_PRESETS.normal;
              console.log('[AutoReply] New guest message on %s — starting %ds debounce', ticket.id, debounceMs / 1000);
              autoReplyCancelledRef.current[ticketId] = false;
              setAutoReplyProcessing(ticketId, true);
              debounceTimersRef.current[ticketId] = setTimeout(() => {
                if (autoReplyCancelledRef.current[ticketId]) {
                  console.log('[AutoReply] Cancelled during debounce for %s', ticketId);
                  setAutoReplyProcessing(ticketId, false);
                  return;
                }
                console.log('[AutoReply] Debounce expired for %s — processing', ticketId);
                processTicket(ticketId);
              }, debounceMs);
            }
          }
        }
      }

      // Detect new messages on background threads (Firestore or proxy) via unreadCount.
      // ticket.messages is only populated for the active thread; for background threads
      // the message count is always 0, so we use unreadCount as the trigger.
      const isBackground = (!!ticket.firestoreThreadId || !!ticket.proxyConversationId) && currentCount === 0;
      if (isBackground && currentUnread > prevUnread) {
        const ticketId = ticket.id;
        if (autoReplyPausedTickets[ticketId]) {
          console.log('[AutoReply] New unread on %s but AI paused — ignoring', ticketId);
        } else {
          if (debounceTimersRef.current[ticketId]) clearTimeout(debounceTimersRef.current[ticketId]);
          const debounceMs = DEBOUNCE_PRESETS[hostConfig?.debouncePreset || 'normal'] || DEBOUNCE_PRESETS.normal;
          console.log('[AutoReply] New unread on background Firestore ticket %s (%d→%d) — starting %ds debounce',
            ticket.id, prevUnread, currentUnread, debounceMs / 1000);
          autoReplyCancelledRef.current[ticketId] = false;
          setAutoReplyProcessing(ticketId, true);
          debounceTimersRef.current[ticketId] = setTimeout(() => {
            if (autoReplyCancelledRef.current[ticketId]) { setAutoReplyProcessing(ticketId, false); return; }
            console.log('[AutoReply] Debounce expired for background Firestore ticket %s — processing', ticketId);
            processTicket(ticketId);
          }, debounceMs);
        }
      }

      // lastGuestMsgRef is updated inline above when hasNewGuestMsg is true
      prevUnreadCountsRef.current[ticket.id] = currentUnread;
    }
  }, [tickets, hasApiKey, agentPresence, hostSettings, processTicket, autoReplyPausedTickets, setAutoReplyProcessing, autoReplyCancelledRef]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of Object.values(debounceTimersRef.current)) clearTimeout(timer);
      for (const timer of Object.values(reEscalationTimersRef.current)) clearTimeout(timer);
    };
  }, []);

  // ─── Reset escalated types when AI is resumed for a ticket ──────
  // When autoReplyHandedOff[id] goes to false (user resumed) or
  // autoReplyPausedTickets[id] goes to false (user unpaused),
  // clear the don't-double-hold guard so AI re-evaluates fresh.
  useEffect(() => {
    for (const ticketId of Object.keys(autoReplyHandedOff)) {
      if (autoReplyHandedOff[ticketId] === false && escalatedTypesRef.current[ticketId]) {
        console.log('[AutoReply] Clearing escalated types for resumed ticket %s', ticketId);
        delete escalatedTypesRef.current[ticketId];
      }
    }
    for (const ticketId of Object.keys(autoReplyPausedTickets)) {
      if (!autoReplyPausedTickets[ticketId] && escalatedTypesRef.current[ticketId]) {
        console.log('[AutoReply] Clearing escalated types for unpaused ticket %s', ticketId);
        delete escalatedTypesRef.current[ticketId];
      }
    }
  }, [autoReplyHandedOff, autoReplyPausedTickets]);
}
// ─── Legacy export for backward compatibility ────────────────────
// (InboxView previously called useAutoReply(activeTicket))
export function useAutoReply(_activeTicket: Ticket | null) {
  // No-op — replaced by useGlobalAutoReply mounted in AppLayout
}

// ─── Rendered inside AppContext.Provider to guarantee context access ──
export function GlobalAutoReplyEffect(): null {
  useGlobalAutoReply();
  return null;
}
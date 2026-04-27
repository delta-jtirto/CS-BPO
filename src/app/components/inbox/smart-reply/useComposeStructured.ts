/**
 * useComposeStructured — SmartReply v2 hook.
 *
 * Single source of truth for per-inquiry section drafts. Hydrates the V2
 * draft row on mount; if the row is empty, calls `composeStructuredReply`
 * and persists. All mutations (edit / regenerate / skip) update local state
 * immediately and debounce a Supabase upsert so rapid keystrokes don't flood
 * the connection.
 *
 * Inputs come from AssistantPanel's `aiInquiries` (LLM-classified with
 * `inquiryKey` stable across re-classifications) — no regex re-detection
 * inside this hook. That's why v1's `detectInquiries` is absent here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAppContext } from '../../../context/AppContext';
import { deriveInquiryKey, type DetectedInquiry } from '../InquiryDetector';
import {
  composeStructuredReply,
  composeStructuredReplySection,
  assembleStructuredReply,
  type StructuredReply,
  type StructuredReplySection,
} from '../../../ai/compose-structured';
import {
  computeMessagesHash,
  computeSnippetHash,
  loadDraftV2,
  saveDraftV2,
  type StoredDraftV2,
  type StoredSection,
  type StoredSectionSource,
} from '../../../../lib/ai-draft-cache';
import { buildPropertyContext } from '../../../ai/kb-context';
import { supabase as supabaseClient } from '../../../../lib/supabase-client';
import type { Ticket } from '../../../data/types';

// ─── Channel-aware tone hints (mirrors useAutoReply) ──────
const CHANNEL_TONE: Record<string, string> = {
  'Airbnb': 'Warm and personal — Airbnb guests expect a friendly, host-like tone. Keep it conversational, 2-3 sentences.',
  'Booking.com': 'Professional and concise — Booking.com guests expect efficient, hotel-style communication. Keep it to 1-2 sentences.',
  'VRBO': 'Friendly and informative — VRBO guests are often families, keep it welcoming and clear.',
  'WhatsApp': 'Casual and brief — this is a chat channel, keep messages short and informal, 1-2 sentences max.',
  'SMS': 'Very brief — SMS has character limits, be extremely concise in 1 sentence.',
  'Email': 'Professional and thorough — email allows for more detail, but stay warm.',
  'Direct': 'Warm and helpful — direct booking guests chose you specifically, make them feel valued.',
};

function buildConversationHistoryPlain(ticket: Ticket): string {
  const messages = (ticket.messages || []).filter(m => m.sender !== 'system').slice(-20);
  if (messages.length === 0) return '';
  const lines = messages.map(m => {
    const role = m.sender === 'guest' ? 'Guest'
      : m.sender === 'bot' ? 'AI'
      : m.sender === 'host' ? 'Host'
      : 'Agent';
    return `[${role}]: ${m.text}`;
  });
  return `Recent conversation:\n${lines.join('\n')}\n\n`;
}

// ─── Props + state types ──────────────────────────────────

export interface UseComposeStructuredProps {
  ticket: Ticket;
  existingDraft: string;
  aiInquiries?: DetectedInquiry[];
}

/** Collision resolution state. We auto-pick `incorporate` when the panel
 *  opens with a typed draft — the vast majority of "I opened Smart Reply
 *  after typing" flows want the AI to consider that text, not ask about
 *  it. Other values are reserved for an explicit override pathway. */
export type TypedDraftCollision = 'none' | 'pending' | 'keep' | 'replace' | 'incorporate';

export interface UseComposeStructuredResult {
  // Data
  draft: StoredDraftV2 | null;
  inquiries: DetectedInquiry[];          // sorted: not-covered first
  assembledText: string;
  /** Set of inquiryKeys whose snippetHash drifted from the current thread. */
  staleKeys: Set<string>;
  /** True when the initial composeStructuredReply call is in flight. */
  isGenerating: boolean;
  /** Set of inquiryKeys currently regenerating (per-card shimmer). */
  generatingKeys: Set<string>;
  /** True when a legacy V1 row was loaded — UI shows "Regenerate to upgrade" CTA. */
  isLegacyDraft: boolean;
  /** Collision state — 'none' for clean open / our own prior insert;
   *  'incorporate' when the agent had typed text we silently folded in. */
  typedDraftCollision: TypedDraftCollision;
  /** True when the panel opened with agent-typed text that was silently
   *  folded into the compose as `agentDraftHint`. Drives the small
   *  "Used your typed draft as context" pill in the panel header. */
  incorporatedTypedDraft: boolean;

  /** Inquiries the classifier marked `handled` — filtered out of cards.
   *  Surface as a small note so the agent knows the full count. */
  handledCount: number;

  // Actions
  /** Escape hatch for the "used your typed draft" pill — runs a fresh
   *  compose without the agent's draft as a hint. */
  discardTypedDraftHint: () => void;
  regenerateSection: (inquiryKey: string, agentNote?: string) => Promise<void>;
  regenerateAll: () => Promise<void>;
  editSection: (inquiryKey: string, text: string) => void;
  skipSection: (inquiryKey: string, skipped: boolean) => void;
  /** Container calls this after onInsert so the `lastSyncedText` field is
   *  persisted alongside the draft — enables collision-free reopen. */
  markSynced: (text: string) => void;
}

// ─── Hook ─────────────────────────────────────────────────

export function useComposeStructured(props: UseComposeStructuredProps): UseComposeStructuredResult {
  const { ticket, existingDraft, aiInquiries } = props;
  const {
    agentName, hasApiKey, promptOverrides, properties, proxyCompanyIds,
    knowledgeChunks, onboardingData, formTemplate, hostSettings,
  } = useAppContext();

  const companyId = proxyCompanyIds[0] ?? 'delta-hq';
  const threadKey = ticket.id;
  const hostConfig = hostSettings.find(s => s.hostId === ticket.host.id);
  const hostTone = hostConfig?.tone ?? 'professional';

  const propContext = useMemo(() => {
    const prop = properties.find(p => p.name === ticket.property) ?? null;
    const roomNames = prop?.roomNames
      ?? (prop?.units === 1 ? ['Entire Property']
          : Array.from({ length: prop?.units ?? 1 }, (_, i) => `Unit ${i + 1}`));
    return buildPropertyContext(
      prop?.id ?? '',
      ticket.property,
      onboardingData,
      formTemplate,
      roomNames,
      [],
      { knowledgeChunks, hostId: ticket.host.id },
    );
  }, [properties, ticket.property, ticket.host.id, onboardingData, formTemplate, knowledgeChunks]);

  const currentMessagesHash = useMemo(
    () => computeMessagesHash(ticket.messages ?? []),
    [ticket.messages],
  );

  // Sort inquiries: not-covered first (matches draft state when available;
  // falls back to ticket-tag based coverage hint — for the pre-compose render).
  // Mutating the stored draft's section order would cause re-render churn, so
  // the sort is a derived view of the aiInquiries list rather than the draft.
  //
  // Backfill `inquiryKey` defensively — rows hydrated from the classify cache
  // that was persisted before Phase A.1 lack the field. Recomputing from
  // type+detail matches the logic at the original creation sites.
  //
  // Filter out inquiries the classifier marked `status: 'handled'` — those
  // were already answered in a prior agent/AI reply, so there's nothing for
  // Smart Reply to compose. They still render in AssistantPanel's "Guest
  // Needs" list so the agent can see the full history.
  const handledCount = (aiInquiries ?? []).filter(i => i.status === 'handled').length;
  const liveInquiries: DetectedInquiry[] = useMemo(
    () => (aiInquiries ?? [])
      .filter(inq => inq.status !== 'handled')
      .map(inq => inq.inquiryKey ? inq : { ...inq, inquiryKey: deriveInquiryKey(inq.type, inq.detail) }),
    [aiInquiries],
  );

  const [draft, setDraft] = useState<StoredDraftV2 | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingKeys, setGeneratingKeys] = useState<Set<string>>(() => new Set());
  const [isLegacyDraft, setIsLegacyDraft] = useState(false);
  // Compose runs fresh without treating the agent's typed text as a hint —
  // auto-incorporate was too magical. Agent retains their typed text in
  // the reply box untouched; they use Apply to opt into the AI draft.
  const initialTypedDraftRef = useRef(existingDraft);
  const [incorporatedTypedDraft, setIncorporatedTypedDraft] = useState<boolean>(false);
  const [typedDraftCollision, setTypedDraftCollision] = useState<TypedDraftCollision>('none');

  // Latest refs for values we read from async flows (regenerate/compose) to
  // avoid stale closures without exploding useCallback deps.
  const draftRef = useRef<StoredDraftV2 | null>(null);
  draftRef.current = draft;
  const currentHashRef = useRef(currentMessagesHash);
  currentHashRef.current = currentMessagesHash;
  const liveInquiriesRef = useRef(liveInquiries);
  liveInquiriesRef.current = liveInquiries;
  const propContextRef = useRef(propContext);
  propContextRef.current = propContext;
  const ticketRef = useRef(ticket);
  ticketRef.current = ticket;

  // ─── Hydrate from Supabase on ticket change ─────────────
  const hydratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (hydratedRef.current === threadKey) return;
    hydratedRef.current = threadKey;
    let cancelled = false;
    setIsLegacyDraft(false);
    void loadDraftV2(supabaseClient, { companyId, threadKey }).then(row => {
      if (cancelled || !row) return;
      if (row.legacy) {
        setIsLegacyDraft(true);
        return;
      }
      setDraft(row.draft);
      // Collision resolution on reopen: if the reply box already holds the
      // text we synced last time, it's OUR prior AI insert — not an
      // agent-typed draft. Silently resolve the collision so the banner
      // doesn't false-positive on our own output.
      //
      // Two-step check: first compare against `lastSyncedText` (authoritative,
      // written by markSynced). Fall back to re-assembling the loaded draft
      // — handles rows written before lastSyncedText existed, and the common
      // "close Smart Reply → reopen without edits" case.
      const trimmedExisting = existingDraft.trim();
      if (trimmedExisting.length === 0) return;
      if (row.draft.lastSyncedText && trimmedExisting === row.draft.lastSyncedText.trim()) {
        setTypedDraftCollision('none');
        return;
      }
      const fallbackAssembled = [
        row.draft.greeting,
        ...Object.values(row.draft.sections)
          .filter(s => !s.isSkipped && s.text.trim().length > 0)
          .map(s => s.text.trim()),
        row.draft.closing,
      ].filter(p => p.trim().length > 0).join('\n\n');
      if (fallbackAssembled && trimmedExisting === fallbackAssembled.trim()) {
        setTypedDraftCollision('none');
      }
    });
    return () => { cancelled = true; };
    // existingDraft intentionally excluded — we only compare at hydration
    // time; later edits to the reply box are handled by the live-sync path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadKey, companyId]);

  // ─── Persist draft (debounced) ──────────────────────────
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistingSourceRef = useRef<StoredSectionSource>('ai');
  const schedulePersist = useCallback((next: StoredDraftV2, source: StoredSectionSource) => {
    persistingSourceRef.current = source;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      void saveDraftV2(supabaseClient, {
        companyId,
        threadKey,
        draft: next,
        messagesHash: currentHashRef.current,
        source: persistingSourceRef.current,
      });
    }, 800);
  }, [companyId, threadKey]);

  // Flush pending persist on unmount so closing the panel mid-edit doesn't
  // lose the last 800ms of typing.
  useEffect(() => () => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      const d = draftRef.current;
      if (d) {
        void saveDraftV2(supabaseClient, {
          companyId, threadKey, draft: d,
          messagesHash: currentHashRef.current,
          source: persistingSourceRef.current,
        });
      }
    }
  }, [companyId, threadKey]);

  // ─── Convert StructuredReply → StoredDraftV2 ────────────
  const toStoredDraft = useCallback(
    (reply: StructuredReply, source: StoredSectionSource): StoredDraftV2 => {
      const messagesHash = currentHashRef.current;
      const sections: Record<string, StoredSection> = {};
      for (const s of reply.sections) {
        sections[s.inquiryKey] = {
          inquiryKey: s.inquiryKey,
          text: s.text,
          covered: s.covered,
          confidence: s.confidence,
          source,
          isSkipped: false,
          isEdited: false,
          snippetHash: computeSnippetHash(s.text, messagesHash),
        };
      }
      return {
        version: 2,
        greeting: reply.greeting,
        sections,
        closing: reply.closing,
        outcome: reply.outcome,
        riskScore: reply.riskScore,
        escalateTopics: reply.escalateTopics,
        promisedActions: reply.promisedActions,
        safetyFlagged: reply.safetyFlagged,
      };
    },
    [],
  );

  // ─── Core: run full compose ─────────────────────────────
  const runCompose = useCallback(async (opts: { agentDraftHint?: string; showToast?: boolean } = {}) => {
    const inqs = liveInquiriesRef.current;
    if (inqs.length === 0) return;
    if (!hasApiKey) {
      if (opts.showToast) toast.warning('No API key configured — skipping AI compose.');
      return;
    }
    setIsGenerating(true);
    try {
      const t = ticketRef.current;
      const reply = await composeStructuredReply({
        hostName: t.host.name,
        hostTone,
        channel: t.channel,
        channelHint: CHANNEL_TONE[t.channel] ?? CHANNEL_TONE['Direct']!,
        guestFirstName: t.guestName.split(' ')[0] ?? t.guestName,
        agentName,
        language: t.language?.split('(')[0]?.trim() || 'English',
        conversationHistory: buildConversationHistoryPlain(t),
        kbContext: propContextRef.current,
        inquiries: inqs,
        agentDraftHint: opts.agentDraftHint,
        promptOverrides,
      });
      const stored = toStoredDraft(reply, 'ai');
      setDraft(stored);
      schedulePersist(stored, 'ai');
    } catch (err) {
      console.error('[useComposeStructured] compose failed:', err);
      if (opts.showToast !== false) {
        toast.error('Compose failed', { description: (err as Error).message });
      }
    } finally {
      setIsGenerating(false);
    }
  }, [agentName, hasApiKey, hostTone, promptOverrides, schedulePersist, toStoredDraft]);

  // ─── Auto-compose on mount when draft is absent ─────────
  const autoComposeTriedRef = useRef<string | null>(null);
  useEffect(() => {
    if (autoComposeTriedRef.current === threadKey) return;
    if (typedDraftCollision === 'keep') return;           // agent explicitly opted out of sync
    if (isLegacyDraft) return;                            // legacy banner handles regenerate
    if (draft !== null) return;                           // already hydrated
    if (liveInquiries.length === 0) return;               // AssistantPanel hasn't classified yet
    autoComposeTriedRef.current = threadKey;
    // Auto-incorporate: pass the pre-mount typed text as a hint to the LLM.
    // For clean-open flows (no typed text), hint is empty and compose runs
    // fresh — same result as before this refactor.
    const hint = typedDraftCollision === 'incorporate' ? initialTypedDraftRef.current : undefined;
    void runCompose({ agentDraftHint: hint });
  }, [threadKey, draft, liveInquiries.length, typedDraftCollision, isLegacyDraft, runCompose]);

  // ─── Actions ────────────────────────────────────────────

  // Escape hatch for the "used your typed draft" pill — re-compose fresh
  // without the hint. We don't try to restore the agent's original text;
  // that path is rarely useful and would add a history-stack concept.
  const discardTypedDraftHint = useCallback(() => {
    setIncorporatedTypedDraft(false);
    setTypedDraftCollision('none');
    autoComposeTriedRef.current = threadKey;
    void runCompose();
  }, [threadKey, runCompose]);


  const regenerateSection = useCallback(async (inquiryKey: string, agentNote?: string) => {
    const current = draftRef.current;
    if (!current) return;
    const inq = liveInquiriesRef.current.find(i => i.inquiryKey === inquiryKey);
    if (!inq) return;
    if (!hasApiKey) {
      toast.warning('No API key configured — cannot regenerate.');
      return;
    }
    setGeneratingKeys(prev => {
      const next = new Set(prev);
      next.add(inquiryKey);
      return next;
    });
    try {
      const t = ticketRef.current;
      const otherSections = Object.values(current.sections)
        .filter(s => s.inquiryKey !== inquiryKey && !s.isSkipped && s.text.trim().length > 0)
        .map(s => {
          const label = liveInquiriesRef.current.find(i => i.inquiryKey === s.inquiryKey)?.label ?? s.inquiryKey;
          return { inquiryKey: s.inquiryKey, label, text: s.text };
        });
      const section = await composeStructuredReplySection({
        hostName: t.host.name,
        hostTone,
        guestFirstName: t.guestName.split(' ')[0] ?? t.guestName,
        agentName,
        language: t.language?.split('(')[0]?.trim() || 'English',
        conversationHistory: buildConversationHistoryPlain(t),
        kbContext: propContextRef.current,
        inquiry: inq,
        otherSections,
        agentNote,
        promptOverrides,
      });
      const messagesHash = currentHashRef.current;
      const updated: StoredDraftV2 = {
        ...current,
        sections: {
          ...current.sections,
          [inquiryKey]: {
            inquiryKey,
            text: section.text,
            covered: section.covered,
            confidence: section.confidence,
            source: 'agent-regen',
            isSkipped: false,
            isEdited: false,
            snippetHash: computeSnippetHash(section.text, messagesHash),
          },
        },
      };
      setDraft(updated);
      schedulePersist(updated, 'agent-regen');
    } catch (err) {
      console.error('[useComposeStructured] regen section failed:', err);
      toast.error('Regenerate failed', { description: (err as Error).message });
    } finally {
      setGeneratingKeys(prev => {
        const next = new Set(prev);
        next.delete(inquiryKey);
        return next;
      });
    }
  }, [agentName, hasApiKey, hostTone, promptOverrides, schedulePersist]);

  const regenerateAll = useCallback(async () => {
    autoComposeTriedRef.current = threadKey;
    await runCompose({ showToast: true });
  }, [threadKey, runCompose]);

  const editSection = useCallback((inquiryKey: string, text: string) => {
    const current = draftRef.current;
    if (!current) return;
    const existing = current.sections[inquiryKey];
    if (!existing) return;
    const messagesHash = currentHashRef.current;
    const updated: StoredDraftV2 = {
      ...current,
      sections: {
        ...current.sections,
        [inquiryKey]: {
          ...existing,
          text,
          isEdited: true,
          source: 'agent-edit',
          snippetHash: computeSnippetHash(text, messagesHash),
        },
      },
    };
    setDraft(updated);
    schedulePersist(updated, 'agent-edit');
  }, [schedulePersist]);

  const skipSection = useCallback((inquiryKey: string, skipped: boolean) => {
    const current = draftRef.current;
    if (!current) return;
    const existing = current.sections[inquiryKey];
    if (!existing) return;
    const updated: StoredDraftV2 = {
      ...current,
      sections: {
        ...current.sections,
        [inquiryKey]: { ...existing, isSkipped: skipped },
      },
    };
    setDraft(updated);
    schedulePersist(updated, 'agent-edit');
  }, [schedulePersist]);

  // Persist `lastSyncedText` alongside the draft so reopen can distinguish
  // "our own prior insert" from "agent-typed text" and suppress the
  // collision banner in the former case. Called by the container's
  // live-sync effect after each onInsert.
  //
  // Save is IMMEDIATE (not debounced): lastSyncedText is the collision
  // detector's only reliable signal on reopen, and the panel can close at
  // any moment. Losing 800ms of potential saves to an unmount flush race
  // beats showing a false-positive banner.
  const markSynced = useCallback((text: string) => {
    const current = draftRef.current;
    if (!current) return;
    if (current.lastSyncedText === text) return;
    const updated: StoredDraftV2 = { ...current, lastSyncedText: text };
    draftRef.current = updated;
    setDraft(updated);
    void saveDraftV2(supabaseClient, {
      companyId,
      threadKey,
      draft: updated,
      messagesHash: currentHashRef.current,
      source: persistingSourceRef.current,
    });
  }, [companyId, threadKey]);

  // ─── Derived values ─────────────────────────────────────

  const sortedInquiries = useMemo(() => {
    if (!draft) {
      // Pre-compose: preserve classification order. No coverage signal yet.
      return liveInquiries;
    }
    const copy = [...liveInquiries];
    copy.sort((a, b) => {
      const ac = draft.sections[a.inquiryKey]?.covered ?? false;
      const bc = draft.sections[b.inquiryKey]?.covered ?? false;
      if (ac === bc) return 0;
      return ac ? 1 : -1; // not-covered first
    });
    return copy;
  }, [liveInquiries, draft]);

  // Assembly order follows the ORIGINAL inquiry order (classify output),
  // not the UI's not-covered-first display sort. The guest should read a
  // coherent reply; "what needs agent input" is a UI-only concern.
  const assembledText = useMemo(() => {
    if (!draft) return '';
    const orderedSections = liveInquiries
      .map(inq => draft.sections[inq.inquiryKey])
      .filter((s): s is StoredSection => !!s);
    return assembleStructuredReply({
      greeting: draft.greeting,
      sections: orderedSections,
      closing: draft.closing,
    });
  }, [draft, liveInquiries]);

  const staleKeys = useMemo(() => {
    const s = new Set<string>();
    if (!draft) return s;
    for (const section of Object.values(draft.sections)) {
      const expected = computeSnippetHash(section.text, currentMessagesHash);
      if (section.snippetHash !== expected) {
        s.add(section.inquiryKey);
      }
    }
    return s;
  }, [draft, currentMessagesHash]);

  return {
    draft,
    inquiries: sortedInquiries,
    assembledText,
    staleKeys,
    isGenerating,
    generatingKeys,
    isLegacyDraft,
    typedDraftCollision,
    incorporatedTypedDraft,
    handledCount,
    discardTypedDraftHint,
    regenerateSection,
    regenerateAll,
    editSection,
    skipSection,
    markSynced,
  };
}

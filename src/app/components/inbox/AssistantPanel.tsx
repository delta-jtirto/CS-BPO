import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react';
import {
  Sparkles, AlertTriangle, ChevronRight, ChevronDown,
  Zap, Shield, MessageSquare, CheckSquare, Square as SquareIcon,
  BookOpen, ArrowRight, Loader2, Pencil,
  Bot, ArrowDown, Copy, RotateCcw, Trash2, Send, PawPrint, RefreshCw, CornerDownLeft
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppContext } from '../../context/AppContext';
import { ScopeBadge } from '../shared/ScopeBadge';
import type { Ticket, InquiryResolutionMap, InquiryResolutionState } from '../../data/types';
import type { OnboardingSection } from '../../data/onboarding-template';
import {
  detectInquiries,
  classifyWithLLM,
  scoreKBForInquiry,
  filterGreetingNoise,
  CLASSIFY_MODEL_VERSION,
  type DetectedInquiry,
  type InquiryKBMatch,
  type ClassifyResult,
} from './InquiryDetector';
import { askAI as askAIProxy, classifyInquiries as classifyInquiriesProxy } from '../../ai/api-client';
import { buildPropertyContext } from '../../ai/kb-context';
import {
  getChatHistory,
  saveChatHistory,
  clearChatHistory,
} from '../../ai/api-client';
import {
  ASK_AI_USER,
  interpolate,
  resolvePrompt,
  resolveModel,
  resolveTemperature,
  resolveMaxTokens,
} from '../../ai/prompts';

// Inquiry type → icon + color mapping
const INQUIRY_STYLE = { icon: <MessageSquare size={12} />, color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200' };

/**
 * Filter out LLM-hallucinated filler text from context items.
 * When the model has no real KB data it sometimes populates context with
 * vague phrases ("I will look into this", "Let me check") instead of
 * leaving the array empty as instructed. We treat those as empty.
 */
const FILLER_PATTERNS = [
  /^i will\b/i, /^i'll\b/i, /^i can\b/i, /^let me\b/i, /^please\b/i,
  /\blook into\b/i, /\bget back\b/i, /\bfollow up\b/i, /\binvestigate\b/i,
  /\bcheck for you\b/i, /\bfind out\b/i, /\bmore information\b/i,
];
function isSubstantiveContextItem(item: { text: string }): boolean {
  const text = item.text.trim();
  return text.length >= 10 && !FILLER_PATTERNS.some(p => p.test(text));
}


interface AssistantPanelProps {
  ticket: Ticket;
  onComposeReply: (text: string) => void;
  onNavigateToKB: (propId: string) => void;
  /** Called whenever inquiry classification finishes — lets parent share context with SmartReplyPanel */
  onInquiriesClassified?: (inquiries: DetectedInquiry[]) => void;
  /** Per-inquiry handled/active state from the three-layer resolution system */
  inquiryResolutions?: InquiryResolutionMap;
  /** Callback when a single inquiry's resolution state changes (manual toggle) */
  onResolutionChange?: (type: string, state: InquiryResolutionState) => void;
  /** Callback to mark all inquiries handled/active at once */
  onBulkResolution?: (handled: boolean) => void;
  /** Callback when AI generates a conversation summary */
  onSummaryUpdate?: (summary: string) => void;
  /** Callback to notify parent about classification loading state */
  onClassifyingChange?: (isClassifying: boolean) => void;
}

// ─── Form field extraction ───────────────────────────────────────────────────

interface FormFieldCard {
  id: string;
  label: string;
  value: string;
  sectionTitle: string;
  /** Set only for per-room sections — e.g. "Unit 1", "Room 2" */
  roomName?: string;
}

/**
 * Scan the onboarding form for filled fields whose label/id matches any of
 * the inquiry's LLM-generated keywords. Avoids a hardcoded slug→section map
 * so new inquiry types Just Work without a UI code change.
 *
 * Matching is substring-based on the lowercased label + id. Keywords are
 * stemmed by the LLM classifier (via `stem()` in InquiryDetector), so we
 * also substring-match the keyword against the label to handle both
 * `park` ↔ `parking` and `restaurant` ↔ `restaurants`.
 */
function extractFormFields(
  keywords: string[],
  propId: string,
  onboardingData: Record<string, Record<string, string>>,
  formTemplate: OnboardingSection[],
  roomNames?: string[],
): FormFieldCard[] {
  if (!keywords.length) return [];
  const kws = keywords.map(k => k.toLowerCase()).filter(k => k.length >= 3);
  if (!kws.length) return [];

  const matches = (label: string, id: string): boolean => {
    const haystack = `${label.toLowerCase()} ${id.toLowerCase()}`;
    return kws.some(kw => haystack.includes(kw) || kw.includes(id.toLowerCase()));
  };

  const formData = onboardingData[propId] || {};
  const results: FormFieldCard[] = [];

  for (const section of formTemplate) {
    if (section.hostHidden || section.id === 'faqs') continue;
    const candidateFields = section.fields.filter(f => !f.hostHidden && matches(f.label, f.id));
    if (!candidateFields.length) continue;

    if (section.perRoom) {
      const maxRooms = roomNames?.length ?? 20;
      for (let r = 0; r < maxRooms; r++) {
        for (const field of candidateFields) {
          const val = formData[`${section.id}__room${r}__${field.id}`]?.trim();
          if (val) {
            results.push({
              id: `${section.id}-room${r}-${field.id}`,
              label: field.label,
              value: val,
              sectionTitle: section.title,
              roomName: roomNames?.[r],
            });
          }
        }
      }
    } else {
      for (const field of candidateFields) {
        const val = formData[`${section.id}__${field.id}`]?.trim();
        if (val) {
          results.push({
            id: `${section.id}-${field.id}`,
            label: field.label,
            value: val,
            sectionTitle: section.title,
          });
        }
      }
    }
  }

  return results;
}

/** Fallback inquiry used when LLM returns empty or fails */
function fallbackGeneralInquiry(ticket: Ticket): DetectedInquiry {
  return {
    id: 'inq-0',
    type: 'general',
    label: 'General Inquiry',
    detail: ticket.summary || 'Guest message requires review',
    confidence: 'low',
    relevantTags: ticket.tags,
    keywords: [],
  };
}

/** Generate a contextual quick-question chip for an inquiry */
function generateQuickQuestion(inq: DetectedInquiry, ticketProperty: string, ticketRoom: string): string {
  // AI-classified inquiries carry the guest's actual detail — use it directly
  if (inq.aiClassified && inq.detail && inq.detail.length > 15) {
    return `${inq.detail} — what do we know?`;
  }
  switch (inq.type) {
    case 'wifi': return `What's the Wi-Fi password for ${ticketRoom || ticketProperty}?`;
    case 'checkin': return `What are the check-in instructions for ${ticketRoom || ticketProperty}?`;
    case 'checkout': return `What's the checkout policy for ${ticketProperty}?`;
    case 'maintenance': return `Who handles maintenance at ${ticketProperty}?`;
    case 'noise': return `What are the quiet hours at ${ticketProperty}?`;
    case 'luggage': return `Is luggage storage available at ${ticketProperty}?`;
    case 'directions': return `How do guests get to ${ticketProperty}?`;
    case 'billing': return `What's the refund policy for ${ticketProperty}?`;
    case 'amenities': return `What amenities are available at ${ticketProperty}?`;
    case 'pet': return `What are the pet policies at ${ticketProperty}?`;
    case 'houserules': return `What are the house rules at ${ticketProperty}?`;
    default: {
      // For AI-classified inquiries, use the detail as a contextual question
      if (inq.aiClassified && inq.detail) {
        return `${inq.detail} — what do we know?`;
      }
      return `What should I know about ${ticketProperty}?`;
    }
  }
}

// ─── Chat message type ──────────────────────────────────
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  /** True when the AI response had no knowledge base articles to draw from */
  noKbContext?: boolean;
}

// Max conversation turns to send in the prompt (sliding window)
const MAX_CONTEXT_TURNS = 3; // 3 user+assistant pairs = 6 messages

export function AssistantPanel({ ticket, onComposeReply, onNavigateToKB, onInquiriesClassified, inquiryResolutions, onResolutionChange, onBulkResolution, onSummaryUpdate, onClassifyingChange }: AssistantPanelProps) {
  const { kbEntries, hasApiKey: hasApiKeyFromCtx, aiModel, onboardingData, formTemplate, properties, hostSettings, promptOverrides, activeMessages, classifyCache } = useAppContext();
  const guestNeedsMode = hostSettings?.[0]?.demoFeatures?.guestNeedsMode ?? 'ai-context';
  const [isAnalyzing, setIsAnalyzing] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Emit classifying state to parent so it can show loading placeholders
  // (e.g. summary banner skeleton) while new classification is in flight.
  useEffect(() => {
    onClassifyingChange?.(isAnalyzing || isRefreshing);
  }, [isAnalyzing, isRefreshing, onClassifyingChange]);
  const [expandedInquiries, setExpandedInquiries] = useState<Set<string>>(new Set());
  const [expandedArticle, setExpandedArticle] = useState<string | null>(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Find property
  const activeProp = properties.find(p => p.name === ticket.property);
  const ticketRoom = ticket.room.replace(/[^0-9]/g, '');
  const hasApiKey = hasApiKeyFromCtx;

  // True when the property has any form data saved (excluding internal-only FAQs key)
  const hasFormData = useMemo(() => {
    const propData = onboardingData[activeProp?.id || ''] || {};
    return Object.keys(propData).some(k => k !== 'faqs__items' && propData[k]?.trim());
  }, [onboardingData, activeProp?.id]);

  // Scope-filtered knowledge base
  const scopeFilteredKb = useMemo(() => {
    return kbEntries.filter(kb =>
      kb.hostId === ticket.host.id &&
      (!kb.propId || kb.propId === activeProp?.id)
    );
  }, [kbEntries, ticket.host.id, activeProp?.id]);

  // Full property context — used by BOTH classify-inquiry and compose-reply
  const propContext = useMemo(() => {
    const prop = properties.find(p => p.name === ticket.property) ?? activeProp;
    const roomNames = prop?.roomNames ?? (prop?.units === 1 ? ['Entire Property'] : Array.from({ length: prop?.units ?? 1 }, (_, i) => `Unit ${i + 1}`));
    return buildPropertyContext(prop?.id ?? '', ticket.property, onboardingData, formTemplate, roomNames, scopeFilteredKb);
  }, [properties, ticket.property, activeProp, onboardingData, formTemplate, scopeFilteredKb]);

  // LLM-primary classification — always fires, regex only as no-API-key fallback
  const [aiInquiries, setAiInquiries] = useState<DetectedInquiry[] | null>(null);
  // Key = ticketId:guestMessageCount — allows re-classification when Firestore messages arrive
  const llmClassifyRef = useRef<string | null>(null);

  // For Firestore tickets, activeMessages (updated directly by the subscription) is more
  // up-to-date than ticket.messages (which goes through a setTickets → re-render cycle).
  // Fall back to ticket.messages for non-Firestore / mock tickets.
  const resolvedMessages = (ticket.firestoreThreadId || ticket.proxyConversationId) && activeMessages.length > 0
    ? activeMessages
    : (ticket.messages || []);

  const resolvedGuestMessages = resolvedMessages
    .filter(m => m.sender === 'guest')
    .map(m => m.text);

  // Full conversation for AI classification (includes agent/bot replies for resolution detection)
  const resolvedConversation = resolvedMessages
    .filter(m => m.sender !== 'system')
    .map(m => {
      const role = m.sender === 'guest' ? 'Guest' : m.sender === 'bot' ? 'AI' : 'Agent';
      return `[${role}]: ${m.text}`;
    });

  // Dedup key: re-classify when ticket, total message count, OR property changes
  // Uses total message count (not just guest) so agent replies trigger re-classification
  const classifyKey = `${ticket.id}:${resolvedMessages.filter(m => m.sender !== 'system').length}:${ticket.property}`;

  // Persistence signature for the cross-session cache. Invariants:
  //   - lastMessageAt captures *when* the guest/agent last said something
  //   - messageCount captures the length of the thread at classification time
  //   - modelVersion captures the prompt/model tier
  // When any of these drift from the stored row, we re-classify.
  //
  // Note: we use `createdAt` (epoch ms) — NOT `Message.id`. The `id` field is
  // a synthetic per-session counter assigned in proxy-mappers.ts and
  // firestore-mappers.ts; it resets on page reload, so two identical
  // conversations see different ids on each visit and the cache would always
  // miss. `createdAt` comes from the source's real timestamp and is stable.
  const nonSystemMessages = resolvedMessages.filter(m => m.sender !== 'system');
  const lastNonSystem = nonSystemMessages[nonSystemMessages.length - 1];
  const classifySignature = {
    lastMessageAt: lastNonSystem?.createdAt ?? 0,
    messageCount: nonSystemMessages.length,
    modelVersion: CLASSIFY_MODEL_VERSION,
  };
  // RLS-scoped company id. Proxy tickets carry their own; Firestore tickets
  // don't surface one (they're scoped by Unified Inbox host), so we fall back
  // to the agent's single-tenant company so the upsert passes RLS.
  const classifyCompanyId = ticket.proxyCompanyId ?? 'delta-hq';

  // Wrapper: set local state + notify parent (SmartReplyPanel consumes via InboxView)
  const updateAiInquiries = useCallback((result: DetectedInquiry[] | null) => {
    setAiInquiries(result);
    if (result !== null) {
      onInquiriesClassified?.(result);
    }
  }, [onInquiriesClassified]);

  /** Handle a ClassifyResult: update inquiries + emit summary */
  const handleClassifyResult = useCallback((cr: ClassifyResult) => {
    updateAiInquiries(cr.inquiries.length > 0 ? cr.inquiries : [fallbackGeneralInquiry(ticket)]);
    if (cr.summary) onSummaryUpdate?.(cr.summary);
  }, [updateAiInquiries, onSummaryUpdate, ticket]);

  const handleRefreshInquiries = () => {
    setIsRefreshing(true);
    llmClassifyRef.current = null;
    // Manual refresh bypasses the persisted cache (skipCache=true on LLM
    // side, no cache lookup here) — but we still OVERWRITE the persisted row
    // on success so the next reload picks up the fresh classification.
    classifyWithLLM(
      resolvedConversation,
      ticket.property,
      ticket.host.name,
      (opts) => classifyInquiriesProxy({ ...opts, model: resolveModel('classify_inquiry', promptOverrides), temperature: resolveTemperature('classify_inquiry', promptOverrides), maxTokens: resolveMaxTokens('classify_inquiry', promptOverrides) }),
      propContext,
      promptOverrides,
      guestNeedsMode,
      true,
    ).then(cr => {
      llmClassifyRef.current = classifyKey;
      handleClassifyResult(cr);
      if (cr.inquiries.length > 0 && classifySignature.lastMessageAt) {
        const existing = classifyCache.entries[ticket.id]?.signature;
        const isAtLeastAsComplete = !existing
          || (classifySignature.messageCount >= existing.messageCount
              && classifySignature.lastMessageAt >= existing.lastMessageAt);
        if (isAtLeastAsComplete) {
          void classifyCache.save(ticket.id, classifyCompanyId, classifySignature, cr);
        }
      }
    }).catch(() => {
      llmClassifyRef.current = classifyKey;
      updateAiInquiries(filterGreetingNoise(detectInquiries(resolvedGuestMessages, ticket.tags, ticket.summary)));
    }).finally(() => {
      setIsRefreshing(false);
    });
  };

  useEffect(() => {
    if (!hasApiKey) {
      const fallback = filterGreetingNoise(detectInquiries(resolvedGuestMessages, ticket.tags, ticket.summary));
      updateAiInquiries(fallback);
      setIsAnalyzing(false);
      return;
    }

    // Wait for the persisted classify cache to hydrate from Supabase. Without
    // this gate, a page refresh runs this effect before the cache fetch
    // completes → getIfFresh returns null → we'd fire the LLM for threads
    // that already have a cached result. llmClassifyRef would then latch the
    // key, so the effect wouldn't re-check even after entries hydrate.
    if (classifyCache.isLoading) return;

    if (llmClassifyRef.current === classifyKey) return;
    llmClassifyRef.current = classifyKey;

    if (resolvedGuestMessages.length === 0) {
      updateAiInquiries([fallbackGeneralInquiry(ticket)]);
      setIsAnalyzing(false);
      return;
    }

    // Persisted cache short-circuit: if Supabase already has a classification
    // for this exact (thread, lastMessageAt, messageCount, modelVersion) tuple,
    // reuse it. Skips the LLM call entirely across reloads and devices.
    if (classifySignature.lastMessageAt) {
      const persisted = classifyCache.getIfFresh(ticket.id, classifySignature);
      if (persisted) {
        console.log('[AssistantPanel] classify cache hit for %s (%d msgs)', ticket.id, classifySignature.messageCount);
        handleClassifyResult(persisted);
        setIsAnalyzing(false);
        return;
      }
    }

    // Show inline refresh spinner (not full skeleton) when re-classifying with existing results
    const isReClassify = aiInquiries !== null && aiInquiries.length > 0;
    if (isReClassify) setIsRefreshing(true);

    classifyWithLLM(
      resolvedConversation,
      ticket.property,
      ticket.host.name,
      (opts) => classifyInquiriesProxy({ ...opts, model: resolveModel('classify_inquiry', promptOverrides), temperature: resolveTemperature('classify_inquiry', promptOverrides), maxTokens: resolveMaxTokens('classify_inquiry', promptOverrides) }),
      propContext,
      promptOverrides,
      guestNeedsMode,
    ).then(cr => {
      console.log('[AssistantPanel] LLM classified %d inquiries for key %s', cr.inquiries.length, classifyKey);
      handleClassifyResult(cr);
      // Persist for future sessions — but treat the cache as monotonic:
      //   * Skip empty results (transient failures, not a real zero state)
      //   * Skip writes that would overwrite a MORE-complete classification.
      //     On cold reload, proxyMessages briefly lands in chunks — the first
      //     render may fire classify at messageCount=2 before the full 12
      //     arrives. Without this guard, that intermediate classify would
      //     stomp the previously-saved count=12 row, and on the next reload
      //     nothing would hit (see commit history for the race analysis).
      if (cr.inquiries.length > 0 && classifySignature.lastMessageAt) {
        const existing = classifyCache.entries[ticket.id]?.signature;
        const isAtLeastAsComplete = !existing
          || (classifySignature.messageCount >= existing.messageCount
              && classifySignature.lastMessageAt >= existing.lastMessageAt);
        if (isAtLeastAsComplete) {
          void classifyCache.save(ticket.id, classifyCompanyId, classifySignature, cr);
        } else {
          console.log('[AssistantPanel] skipping cache save — incoming sig',
            classifySignature, 'is less complete than stored', existing);
        }
      }
    }).catch(err => {
      console.error('[AssistantPanel] LLM classification failed, falling back to regex:', err);
      updateAiInquiries(filterGreetingNoise(detectInquiries(resolvedGuestMessages, ticket.tags, ticket.summary)));
    }).finally(() => {
      setIsAnalyzing(false);
      setIsRefreshing(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classifyKey, hasApiKey, aiModel, propContext, classifyCache.isLoading]);

  // All inquiries come from LLM (or regex fallback when no API key)
  // Deduplicate: merge same-type inquiries, combining their details
  const inquiries = (() => {
    const filtered = filterGreetingNoise(aiInquiries ?? []);
    const seen = new Map<string, typeof filtered[0]>();
    for (const inq of filtered) {
      if (seen.has(inq.type)) {
        const existing = seen.get(inq.type)!;
        // Merge detail if different
        if (!existing.detail.includes(inq.detail)) {
          existing.detail = existing.detail + '; ' + inq.detail;
        }
        // Merge context items, deduping by text
        if (inq.context?.length) {
          const existingTexts = new Set((existing.context ?? []).map(c => c.text));
          existing.context = [...(existing.context ?? []), ...inq.context.filter(c => !existingTexts.has(c.text))];
        }
      } else {
        seen.set(inq.type, { ...inq });
      }
    }
    return Array.from(seen.values());
  })();

  // Score knowledge base per inquiry
  const kbMatchesByInquiry = useMemo(() => {
    const result: Record<string, InquiryKBMatch[]> = {};
    for (const inq of inquiries) {
      const withRoomBoost = scopeFilteredKb.map(kb => {
        if (kb.roomId && ticketRoom && kb.roomId === ticketRoom) {
          return { ...kb, tags: [...(kb.tags || []), '__room_match__'] };
        }
        return kb;
      });
      const matches = scoreKBForInquiry(inq, withRoomBoost);
      result[inq.id] = matches.map(m => ({
        ...m,
        score: m.entry.roomId && ticketRoom && m.entry.roomId === ticketRoom
          ? m.score + 50
          : m.score,
      })).sort((a, b) => b.score - a.score);
    }
    return result;
  }, [inquiries, scopeFilteredKb, ticketRoom]);

  // Extract relevant form fields per inquiry from onboardingData
  // Fields are deduplicated across inquiry cards — a field shown in card #1 won't repeat in card #2
  const formFieldsByInquiry = useMemo(() => {
    // Resolve the prop from ticket.property first (set by the manual picker on
    // proxy tickets), falling back to activeProp. This mirrors propContext so
    // proxy tickets read the same onboarding data that gets injected into the
    // classify prompt — otherwise activeProp can point at a stale default and
    // formData comes back empty.
    const prop = properties.find(p => p.name === ticket.property) ?? activeProp;
    const roomNames = prop?.roomNames
      ?? (prop?.units === 1 ? ['Entire Property'] : Array.from({ length: prop?.units ?? 1 }, (_, i) => `Unit ${i + 1}`));
    const result: Record<string, FormFieldCard[]> = {};
    const seenFieldIds = new Set<string>();
    for (const inq of inquiries) {
      const fields = extractFormFields(inq.keywords ?? [], prop?.id || '', onboardingData, formTemplate, roomNames)
        .filter(f => !seenFieldIds.has(f.id));
      for (const f of fields) seenFieldIds.add(f.id);
      result[inq.id] = fields;
    }
    return result;
  }, [inquiries, activeProp, onboardingData, formTemplate, properties, ticket.property]);

  // ─── Inquiry Resolution: partition into Active / Handled ───
  // Priority: manual override > AI classification > default active
  const isHandled = (inq: DetectedInquiry) => {
    const manual = inquiryResolutions?.[inq.type];
    if (manual) return manual.handled; // manual toggle overrides AI
    return inq.status === 'handled';   // AI-classified status
  };
  const activeInquiries = inquiries.filter(inq => !isHandled(inq));
  const handledInquiries = inquiries.filter(inq => isHandled(inq));
  const [handledSectionOpen, setHandledSectionOpen] = useState(false);

  // Quick question chips (deduplicated by inquiry type)
  const quickQuestions = useMemo(() => {
    const seen = new Set<string>();
    return inquiries
      .filter(inq => { if (seen.has(inq.type)) return false; seen.add(inq.type); return true; })
      .map(inq => ({
        id: inq.id,
        question: generateQuickQuestion(inq, ticket.property, ticket.room),
        type: inq.type,
      }));
  }, [inquiries, ticket.property, ticket.room]);

  // Reset state + load chat on ticket switch
  // This fires only when ticket.id changes — same-ticket re-classification
  // uses the classifyKey effect below (which keeps stale cards visible).
  useEffect(() => {
    setIsAnalyzing(true);
    setExpandedInquiries(new Set());
    setExpandedArticle(null);
    setInputText('');
    setIsThinking(false);
    // Clear stale inquiries from the previous ticket so skeleton shows
    // while the new ticket is being classified. Prevents wrong-context flash.
    updateAiInquiries(null);
    setChatMessages([]); // Clear old thread's chat immediately
    llmClassifyRef.current = null;

    // Load persisted chat from backend
    let cancelled = false;
    getChatHistory(ticket.id).then(saved => {
      if (cancelled) return;
      setChatMessages(saved as ChatMessage[]);
    }).catch(() => {
      if (!cancelled) setChatMessages([]);
    });

    return () => { cancelled = true; };
  }, [ticket.id]);

  // Auto-expand first inquiry once analysis completes
  useEffect(() => {
    if (!isAnalyzing && inquiries.length > 0) {
      setExpandedInquiries(new Set([inquiries[0].id]));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnalyzing]);

  // Persist chat to BE whenever messages change (debounced)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isAnalyzing) return; // Don't save during initial load
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveChatHistory(ticket.id, chatMessages);
    }, 400);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [chatMessages, ticket.id, isAnalyzing]);

  // Auto-scroll chat on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length, isThinking]);

  // ─── Build full property context for AI (form data + manual KB) ──────────────
  const getKBContext = useCallback((): string => {
    return propContext;
  }, [propContext]);

  // ─── Ask AI (chat-aware) ──────────────────────────────────────
  const handleSend = useCallback(async (overrideText?: string) => {
    const question = (overrideText || inputText).trim();
    if (!question || isThinking) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: question,
      timestamp: Date.now(),
    };

    setChatMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsThinking(true);

    if (hasApiKey) {
      try {
        const kbContext = getKBContext();

        // Build conversation context from sliding window
        const allMessages = [...chatMessages, userMsg];
        const recentPairs = allMessages.slice(-(MAX_CONTEXT_TURNS * 2));
        const conversationHistory = recentPairs.length > 1
          ? recentPairs.slice(0, -1) // exclude the current question (it goes in userPrompt)
              .map(m => `[${m.role === 'user' ? 'Agent' : 'AI'}] ${m.text}`)
              .join('\n')
          : '';

        const recentGuestMessages = resolvedMessages
          .slice(-6)
          .map(m => `[${m.sender}] ${m.text}`)
          .join('\n');

        const userPrompt = interpolate(resolvePrompt('ask_ai', 'user', promptOverrides), {
          propertyName: ticket.property,
          hostName: ticket.host.name,
          question: question,
          kbEntries: kbContext || '(no knowledge base articles available)',
        });

        const enrichedPrompt = [
          userPrompt,
          `\nRecent guest conversation:\n${recentGuestMessages}`,
          conversationHistory ? `\nPrior research chat (for context — the agent is following up):\n${conversationHistory}` : '',
        ].filter(Boolean).join('\n');

        const result = await askAIProxy({
          systemPrompt: resolvePrompt('ask_ai', 'system', promptOverrides),
          userPrompt: enrichedPrompt,
          model: resolveModel('ask_ai', promptOverrides),
          temperature: resolveTemperature('ask_ai', promptOverrides),
          maxTokens: resolveMaxTokens('ask_ai', promptOverrides),
        });

        const assistantMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: result.text,
          timestamp: Date.now(),
          noKbContext: kbContext === '',
        };
        setChatMessages(prev => [...prev, assistantMsg]);
      } catch (err: any) {
        const errMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: `Error: ${err.message}`,
          timestamp: Date.now(),
        };
        setChatMessages(prev => [...prev, errMsg]);
      }
    } else {
      // Fallback: keyword search
      await new Promise(r => setTimeout(r, 500));
      const q = question.toLowerCase();
      const matches = scopeFilteredKb
        .map(kb => {
          const text = (kb.title + ' ' + kb.content).toLowerCase();
          const words = q.split(/\W+/).filter(w => w.length > 3);
          const hits = words.filter(w => text.includes(w));
          return { kb, score: hits.length };
        })
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);

      const answer = matches.length > 0
        ? matches.map(m => `${m.kb.title}: ${m.kb.content}`).join('\n\n')
        : 'No relevant information found in the knowledge base for this property. You may want to check with the host directly or add a custom article for next time.';

      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: answer,
        timestamp: Date.now(),
      };
      setChatMessages(prev => [...prev, assistantMsg]);
    }

    setIsThinking(false);
    inputRef.current?.focus();
  }, [inputText, isThinking, hasApiKey, aiModel, scopeFilteredKb, ticket, chatMessages, getKBContext]);

  const handleClearChat = useCallback(() => {
    setChatMessages([]);
    setInputText('');
    setIsThinking(false);
    clearChatHistory(ticket.id); // Delete from BE
    toast.success('Chat cleared');
    inputRef.current?.focus();
  }, [ticket.id]);

  const handleRefreshLast = useCallback(() => {
    // Re-ask the last user question
    const lastUserMsg = [...chatMessages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return;
    // Remove the last assistant response
    setChatMessages(prev => {
      const idx = prev.length - 1;
      if (idx >= 0 && prev[idx].role === 'assistant') return prev.slice(0, -1);
      return prev;
    });
    handleSend(lastUserMsg.text);
  }, [chatMessages, handleSend]);

  const handleInsertMsg = useCallback((text: string) => {
    onComposeReply(text);
    toast.success('Inserted into reply', { description: 'Review and edit before sending.' });
  }, [onComposeReply]);

  const handleCopyMsg = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  }, []);

  // ─── Analyzing skeleton ────────────────────────────────────────────
  if (isAnalyzing) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        <div className="flex items-center gap-2 text-indigo-600">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-xs font-bold">Analyzing conversation...</span>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="space-y-2">
              <div className="h-3 bg-slate-200 rounded w-2/3" />
              <div className="h-2 bg-slate-100 rounded w-full" />
              <div className="h-2 bg-slate-100 rounded w-4/5" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">

        {/* ─── Ask AI — Chat Interface ─────────────────────────── */}
        <div className="flex flex-col border-b border-slate-100">
          {/* Header */}
          <div className="px-4 pt-3 pb-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot size={12} className="text-indigo-600" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ask AI</span>
            </div>
            {chatMessages.length > 0 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleRefreshLast}
                  disabled={isThinking || chatMessages.length === 0}
                  className="p-1 text-slate-400 hover:text-indigo-600 disabled:opacity-30 transition-colors rounded"
                  title="Re-ask last question"
                >
                  <RotateCcw size={11} />
                </button>
                <button
                  onClick={handleClearChat}
                  disabled={isThinking}
                  className="p-1 text-slate-400 hover:text-red-500 disabled:opacity-30 transition-colors rounded"
                  title="Clear conversation"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            )}
          </div>

          {/* Quick question chips — short labels, click to ask AI about the topic */}
          {quickQuestions.length > 0 && (
            <div className={`px-4 flex flex-wrap gap-1 ${chatMessages.length > 0 ? 'pb-1.5' : 'pb-2.5'}`}>
              {quickQuestions.map(qq => {
                const inq = inquiries.find(i => i.id === qq.id);
                const label = inq?.label || qq.type;
                return (
                  <button
                    key={qq.id}
                    onClick={() => handleSend(qq.question)}
                    disabled={isThinking}
                    className="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-md hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-100 transition-colors disabled:opacity-50"
                    title={qq.question}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Chat messages area */}
          {(chatMessages.length > 0 || isThinking) && (
            <div className="px-3 pb-2 max-h-64 overflow-y-auto space-y-2">
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-1 duration-150`}
                >
                  {msg.role === 'user' ? (
                    <div className="max-w-[85%] px-3 py-1.5 rounded-2xl rounded-tr-sm bg-indigo-600 text-white text-[11px] leading-relaxed">
                      {msg.text}
                    </div>
                  ) : (
                    <div className="max-w-[92%] group">
                      <div className="flex items-center gap-1 mb-0.5">
                        <Bot size={9} className="text-indigo-500" />
                        <span className="text-[9px] text-slate-400">AI</span>
                      </div>
                      <div className="px-2.5 py-2 bg-indigo-50 border border-indigo-200 rounded-2xl rounded-tl-sm text-[10px] text-slate-700 whitespace-pre-wrap leading-relaxed">
                        {msg.text}
                      </div>
                      {/* Action buttons */}
                      <div className="flex items-center gap-1 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleInsertMsg(msg.text)}
                          className="flex items-center gap-0.5 text-[9px] font-medium text-indigo-500 hover:text-indigo-700 px-1.5 py-0.5 rounded hover:bg-indigo-50 transition-colors"
                        >
                          <ArrowDown size={8} /> Insert
                        </button>
                        <button
                          onClick={() => handleCopyMsg(msg.text)}
                          className="flex items-center gap-0.5 text-[9px] font-medium text-slate-400 hover:text-slate-600 px-1.5 py-0.5 rounded hover:bg-slate-50 transition-colors"
                        >
                          <Copy size={8} /> Copy
                        </button>
                      </div>
                      {/* No coverage hint */}
                      {msg.noKbContext && (
                        <div className="flex items-center gap-1 mt-1 px-1">
                          <AlertTriangle size={8} className="text-amber-500" />
                          <span className="text-[8px] text-amber-600">No articles matched — consider adding one after resolving this.</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Thinking indicator */}
              {isThinking && (
                <div className="flex items-start gap-1.5 animate-in fade-in duration-150">
                  <div className="flex items-center gap-1 mt-0.5">
                    <Bot size={9} className="text-indigo-500" />
                  </div>
                  <div className="px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-2xl rounded-tl-sm">
                    <div className="flex items-center gap-1.5">
                      <Loader2 size={10} className="animate-spin text-indigo-500" />
                      <span className="text-[10px] text-indigo-600">Thinking...</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          )}

          {/* Input bar */}
          <div className="px-3 pb-3">
            <div className="relative flex items-center">
              <input
                ref={inputRef}
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder={chatMessages.length > 0 ? 'Follow up...' : 'Ask about this property...'}
                className="w-full border border-slate-200 rounded-xl py-2 pl-3 pr-16 text-[11px] focus:ring-1 focus:ring-indigo-500 outline-none transition-colors"
                disabled={isThinking}
              />
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                <button
                  onClick={() => handleSend()}
                  disabled={isThinking || !inputText.trim()}
                  className="p-1.5 rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-30 disabled:bg-slate-300 transition-all active:scale-95"
                >
                  {isThinking ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                </button>
              </div>
            </div>
            {chatMessages.length > 0 && (
              <div className="flex items-center justify-between mt-1 px-1">
                <span className="text-[9px] text-slate-300">
                  {chatMessages.filter(m => m.role === 'user').length} question{chatMessages.filter(m => m.role === 'user').length !== 1 ? 's' : ''}
                </span>
                <span className="text-[9px] text-slate-300">
                  last {MAX_CONTEXT_TURNS} exchanges
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ─── What the guest needs ────────────────────────────── */}
        <div className="px-3 pt-4 pb-4">
          {/* Section header */}
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">What the guest needs</span>
            {activeInquiries.length > 0 && (
              <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-full font-bold tabular-nums">{activeInquiries.length}</span>
            )}
            <button
              onClick={handleRefreshInquiries}
              disabled={isRefreshing}
              className="text-slate-300 hover:text-slate-500 transition-colors disabled:cursor-not-allowed"
              title="Re-analyse guest needs"
            >
              <RefreshCw size={11} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            {activeInquiries.length > 0 && onBulkResolution && (
              <button
                onClick={() => onBulkResolution(true)}
                className="ml-auto text-[9px] text-slate-400 hover:text-slate-600 hover:underline transition-colors"
              >
                Mark all handled
              </button>
            )}
          </div>

          {/* Inquiry cards — keep existing cards visible during re-classification */}
          <div className={`space-y-1.5 transition-opacity duration-200 ${isRefreshing ? 'opacity-60' : ''}`}>
            {inquiries.length === 0 && isRefreshing ? (
              <div className="space-y-2 animate-pulse">
                {[1, 2].map(i => (
                  <div key={i} className="rounded-xl border border-slate-100 p-3 space-y-1.5">
                    <div className="h-2.5 bg-slate-200 rounded w-1/2" />
                    <div className="h-2 bg-slate-100 rounded w-full" />
                    <div className="h-2 bg-slate-100 rounded w-3/4" />
                  </div>
                ))}
              </div>
            ) : (<>
              {/* ── Active inquiries ── */}
              {activeInquiries.map((inq, idx) => {
              const isHandledCard = false;
              const resState = inquiryResolutions?.[inq.type];
              const style = INQUIRY_STYLE;
              const isExpanded = expandedInquiries.has(inq.id);
              const matches = kbMatchesByInquiry[inq.id] || [];
              const formFields = formFieldsByInquiry[inq.id] || [];
              const coverageStatus = matches.length > 0 ? 'kb' : formFields.length > 0 ? 'form' : 'none';
              // For social/greeting inquiries where no KB lookup is needed, treat as 'ok' to suppress the yellow warning
              const needsKb = inq.needsKbSearch !== false;

              return (
                <div
                  key={inq.id}
                  className={`rounded-xl border overflow-hidden transition-all duration-200 ${style.border} ${isExpanded ? 'shadow-sm' : ''}`}
                >
                  {/* ── Card header (always visible) ── */}
                  {/* div+role instead of button so the inline Bot action doesn't nest inside a button */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setExpandedInquiries(prev => { const s = new Set(prev); isExpanded ? s.delete(inq.id) : s.add(inq.id); return s; });
                      setExpandedArticle(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setExpandedInquiries(prev => { const s = new Set(prev); isExpanded ? s.delete(inq.id) : s.add(inq.id); return s; });
                        setExpandedArticle(null);
                      }
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors cursor-pointer ${isExpanded ? style.bg : 'bg-white hover:bg-slate-50/80'}`}
                  >
                    {/* Intent icon in a tinted circle */}
                    <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${style.bg}`}>
                      <span className={style.color}>{style.icon}</span>
                    </div>

                    {/* Label + detail */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-bold text-slate-300 tabular-nums">#{idx + 1}</span>
                        {resState?.reopened && !isHandledCard && (
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" title="Guest brought this topic back" />
                        )}
                        <span className={`text-[11px] font-semibold leading-tight ${isHandledCard ? 'text-slate-400' : style.color}`}>{inq.label}</span>
                        {inq.aiClassified && (
                          <span className="text-[7px] font-bold text-violet-600 bg-violet-50 border border-violet-200 px-1 py-0.5 rounded">AI</span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 truncate leading-tight mt-0.5">{inq.detail}</p>
                    </div>

                    {/* Coverage chip + chevron */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {guestNeedsMode === 'kb-scoring' && coverageStatus === 'kb' && (
                        <span className="text-[9px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full tabular-nums">
                          {matches.length} {matches.length === 1 ? 'article' : 'articles'}
                        </span>
                      )}
                      {guestNeedsMode === 'kb-scoring' && coverageStatus === 'form' && (
                        <span className="text-[8px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-0.5 tabular-nums">
                          <Sparkles size={7} /> {formFields.length} {formFields.length === 1 ? 'field' : 'fields'}
                        </span>
                      )}
                      {guestNeedsMode === 'kb-scoring' && coverageStatus === 'none' && needsKb && (
                        <>
                          <span className="text-[8px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                            <AlertTriangle size={7} /> Gap
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSend(generateQuickQuestion(inq, ticket.property, ticket.room));
                            }}
                            className="shrink-0 p-1 rounded-lg bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 transition-colors"
                            title="Ask AI about this gap"
                          >
                            <Bot size={10} className="text-indigo-600" />
                          </button>
                        </>
                      )}
                      {guestNeedsMode === 'ai-context' && needsKb && (inq.context ?? []).filter(isSubstantiveContextItem).length === 0 && formFields.length === 0 && (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="No info on file for this topic" />
                      )}
                      {/* Resolution toggle */}
                      {onResolutionChange && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onResolutionChange(inq.type, {
                              handled: !isHandledCard,
                              source: 'manual',
                              updatedAt: Date.now(),
                            });
                          }}
                          className="shrink-0 p-0.5 rounded hover:bg-slate-100 transition-colors"
                          title={isHandledCard ? 'Mark as active' : 'Mark as handled'}
                        >
                          {isHandledCard
                            ? <CheckSquare size={12} className="text-emerald-500" />
                            : <SquareIcon size={12} className="text-slate-300 hover:text-slate-500" />
                          }
                        </button>
                      )}
                      <ChevronDown
                        size={13}
                        className={`text-slate-300 transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`}
                      />
                    </div>
                  </div>

                  {/* ── Expanded body ── */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-white">

                      {/* AI Summary mode — plain text context */}
                      {guestNeedsMode === 'ai-context' && (
                        <div className="px-3 py-2.5">
                          {(() => {
                            const rawItems = inq.context ?? [];
                            // Filter out LLM-hallucinated filler so a vague "I'll look into this"
                            // doesn't mask a genuine KB gap
                            const llmItems = rawItems.filter(isSubstantiveContextItem);
                            // Deterministic fallback: when the LLM returns no usable context,
                            // surface form-field values matched by the inquiry's keywords.
                            // Tagged "kb" so they render as authoritative facts, not estimates.
                            const formItems = llmItems.length === 0
                              ? formFields.map(f => ({
                                  section: f.roomName ? `${f.sectionTitle} — ${f.roomName}` : f.sectionTitle,
                                  text: `${f.label}: ${f.value}`,
                                  source: 'kb' as const,
                                }))
                              : [];
                            const items = llmItems.length > 0 ? llmItems : formItems;
                            const isGreeting = inq.needsKbSearch === false;
                            const isGap = items.length === 0 && !isGreeting;

                            if (isGreeting) return (
                              <p className="text-[10px] text-slate-400 italic">No additional context needed.</p>
                            );

                            if (isGap) return (
                              <div className="flex items-start gap-2">
                                <div className="flex-1">
                                  <p className="text-[10px] text-amber-700 font-medium">No info on file for this topic.</p>
                                  <p className="text-[10px] text-slate-400 mt-0.5">Add it to your KB, or ask AI to research.</p>
                                </div>
                                <button
                                  onClick={() => handleSend(generateQuickQuestion(inq, ticket.property, ticket.room))}
                                  className="shrink-0 flex items-center gap-1 text-[9px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 px-2 py-1 rounded-lg transition-colors"
                                  title="Ask AI to research this topic"
                                >
                                  <Bot size={9} /> Ask AI
                                </button>
                              </div>
                            );
                            // else: items.length > 0 — show context items below
                            // Group by section
                            const sections = items.reduce<Record<string, typeof items>>((acc, item) => {
                              (acc[item.section] ??= []).push(item);
                              return acc;
                            }, {});
                            const hasAiItems = items.some(i => i.source === 'ai');
                            return (
                              <div className="space-y-2">
                                {Object.entries(sections).map(([section, sectionItems]) => (
                                  <div key={section}>
                                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{section}</p>
                                    <div className="space-y-0.5">
                                      {sectionItems.map((item, i) => (
                                        <div key={i} className="group flex gap-1.5 items-start">
                                          <span className="text-indigo-400 shrink-0 leading-none mt-[3px]">•</span>
                                          <span className={`text-[11px] leading-snug flex-1 ${item.source === 'ai' ? 'text-slate-400 italic' : 'text-slate-600'}`}>
                                            {item.text}
                                          </span>
                                          {item.source === 'kb' && (
                                            <span className="shrink-0 text-[8px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 px-1 py-0.5 rounded leading-none mt-[2px]">KB</span>
                                          )}
                                          {item.source === 'ai' && (
                                            <span className="shrink-0 text-[8px] font-medium text-slate-400 bg-slate-100 px-1 py-0.5 rounded leading-none mt-[2px]">est.</span>
                                          )}
                                          <button
                                            onClick={(e) => { e.stopPropagation(); handleInsertMsg(item.text); }}
                                            title="Insert into reply"
                                            className="shrink-0 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-40 [@media(hover:none)]:active:opacity-100 text-indigo-500 hover:text-indigo-700 transition-opacity mt-[1px]"
                                          >
                                            <CornerDownLeft size={10} />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                                {hasAiItems && (
                                  <p className="text-[9px] text-slate-400 italic pt-1 border-t border-slate-100">
                                    <span className="font-medium">est.</span> = general estimate — verify before sharing with guest
                                  </p>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* KB Matching mode — KB article cards */}
                      {guestNeedsMode === 'kb-scoring' && coverageStatus === 'kb' && (
                        <div className="p-2.5 space-y-1.5">
                          {matches.map((m) => {
                            const cardKey = `kb-${m.entry.id}`;
                            const isArticleOpen = expandedArticle === cardKey;
                            const isInternal = m.isActionable || m.entry.internal;
                            return (
                              <div
                                key={cardKey}
                                className={`rounded-lg border overflow-hidden transition-all duration-150 ${
                                  isInternal ? 'border-amber-200' : 'border-slate-200'
                                }`}
                              >
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedArticle(isArticleOpen ? null : cardKey);
                                  }}
                                  className={`w-full flex items-start gap-2.5 px-2.5 py-2 text-left transition-colors ${
                                    isInternal
                                      ? 'bg-amber-50/60 hover:bg-amber-50'
                                      : isArticleOpen
                                        ? 'bg-slate-50'
                                        : 'bg-white hover:bg-slate-50/70'
                                  }`}
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 mb-1">
                                      <span className="text-[11px] font-semibold text-slate-700 leading-tight">{m.entry.title}</span>
                                      {isInternal && (
                                        <span className="shrink-0 text-[7px] font-bold text-amber-700 bg-amber-100 px-1 py-0.5 rounded border border-amber-200">
                                          Agent-only
                                        </span>
                                      )}
                                    </div>
                                    <p className={`text-[10px] text-slate-500 leading-relaxed ${isArticleOpen ? '' : 'line-clamp-2'}`}>
                                      {m.entry.content}
                                    </p>
                                    {isArticleOpen && (
                                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                        <ScopeBadge scope={m.entry.scope} />
                                        {m.entry.source === 'manual' && (
                                          <span className="text-[8px] text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                            <Pencil size={7} /> Custom entry
                                          </span>
                                        )}
                                        {!m.entry.source && (
                                          <span className="text-[8px] text-slate-400 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded-full">
                                            Seed data
                                          </span>
                                        )}
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleInsertMsg(m.entry.content); }}
                                          title="Insert into reply"
                                          className="ml-auto flex items-center gap-0.5 text-[8px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-full hover:bg-indigo-100 transition-colors"
                                        >
                                          <CornerDownLeft size={7} /> Insert
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  <ChevronDown
                                    size={11}
                                    className={`shrink-0 mt-0.5 text-slate-300 transition-transform duration-150 ${isArticleOpen ? '' : '-rotate-90'}`}
                                  />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Form field cards — actual values from onboarding form */}
                      {guestNeedsMode === 'kb-scoring' && coverageStatus === 'form' && (
                        <div className="p-2.5 space-y-1.5">
                          {/* Subtle provenance note */}
                          <div className="flex items-center gap-1 px-0.5 mb-2">
                            <Sparkles size={8} className="text-emerald-500" />
                            <span className="text-[9px] text-emerald-600 font-medium">From property form · AI has this info</span>
                          </div>
                          {formFields.map((field) => {
                            const cardKey = `form-${field.id}`;
                            const isFieldOpen = expandedArticle === cardKey;
                            return (
                              <div key={cardKey} className="rounded-lg border border-slate-200 overflow-hidden transition-all duration-150">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedArticle(isFieldOpen ? null : cardKey);
                                  }}
                                  className={`w-full flex items-start gap-2.5 px-2.5 py-2 text-left transition-colors ${
                                    isFieldOpen ? 'bg-slate-50' : 'bg-white hover:bg-slate-50/70'
                                  }`}
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                      <span className="text-[11px] font-semibold text-slate-700 leading-tight">{field.label}</span>
                                      {field.roomName && (
                                        <span className="text-[7px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full leading-none">
                                          {field.roomName}
                                        </span>
                                      )}
                                    </div>
                                    <p className={`text-[10px] text-slate-500 leading-relaxed ${isFieldOpen ? '' : 'line-clamp-2'}`}>
                                      {field.value}
                                    </p>
                                    {isFieldOpen && (
                                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                        <span className="text-[8px] text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                          <Sparkles size={7} /> Form · {field.sectionTitle}
                                        </span>
                                        {field.roomName && (
                                          <span className="text-[8px] text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">
                                            {field.roomName}
                                          </span>
                                        )}
                                        {field.value && (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); handleInsertMsg(field.value); }}
                                            title="Insert into reply"
                                            className="ml-auto flex items-center gap-0.5 text-[8px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-full hover:bg-indigo-100 transition-colors"
                                          >
                                            <CornerDownLeft size={7} /> Insert
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <ChevronDown
                                    size={11}
                                    className={`shrink-0 mt-0.5 text-slate-300 transition-transform duration-150 ${isFieldOpen ? '' : '-rotate-90'}`}
                                  />
                                </button>
                              </div>
                            );
                          })}
                          {/* Ask AI button at the bottom */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSend(generateQuickQuestion(inq, ticket.property, ticket.room));
                            }}
                            className="w-full mt-1 text-[10px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors flex items-center justify-center gap-1"
                          >
                            <Bot size={10} /> Ask AI about this
                          </button>
                        </div>
                      )}

                      {/* Not covered */}
                      {guestNeedsMode === 'kb-scoring' && coverageStatus === 'none' && needsKb && (
                        <div className="p-3 space-y-2">
                          <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                            <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
                            <div>
                              <p className="text-[10px] font-semibold text-amber-800">No info on file</p>
                              <p className="text-[9px] text-amber-600 mt-0.5 leading-relaxed">
                                {inq.detail || `Guest asked about ${inq.label.toLowerCase()}.`} — reply manually or add an article so AI can handle it next time.
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSend(generateQuickQuestion(inq, ticket.property, ticket.room));
                              }}
                              className="flex-1 text-[10px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors flex items-center justify-center gap-1"
                            >
                              <Bot size={10} /> Ask AI
                            </button>
                            {activeProp && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onNavigateToKB(activeProp.id); }}
                                className="flex-1 text-[10px] font-medium text-slate-600 bg-white border border-slate-200 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-center gap-1"
                              >
                                <Pencil size={10} /> Add article
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                    </div>
                  )}
                </div>
              );
            })}

              {/* ── Handled section ── */}
              {handledInquiries.length > 0 && (
                <div className="mt-2">
                  <button
                    onClick={() => setHandledSectionOpen(prev => !prev)}
                    className="w-full flex items-center gap-2 py-1 group"
                  >
                    <div className="flex-1 h-px bg-slate-100" />
                    <span className="text-[9px] font-medium text-slate-300 uppercase tracking-wider flex items-center gap-1 group-hover:text-slate-400 transition-colors">
                      Handled
                      <span className="text-[9px] bg-slate-50 text-slate-400 px-1.5 py-0.5 rounded-full tabular-nums">{handledInquiries.length}</span>
                      <ChevronDown size={9} className={`transition-transform duration-200 ${handledSectionOpen ? '' : '-rotate-90'}`} />
                    </span>
                    <div className="flex-1 h-px bg-slate-100" />
                  </button>

                  {handledSectionOpen && (
                    <div className="space-y-1 mt-1">
                      {handledInquiries.map((inq, idx) => {
                        const isHandledCard = true;
                        const resState = inquiryResolutions?.[inq.type];
                        const style = INQUIRY_STYLE;
                        const isExpanded = expandedInquiries.has(inq.id);
                        const matches = kbMatchesByInquiry[inq.id] || [];
                        const formFields = formFieldsByInquiry[inq.id] || [];
                        const coverageStatus = matches.length > 0 ? 'kb' : formFields.length > 0 ? 'form' : 'none';
                        const needsKb = inq.needsKbSearch !== false;

                        return (
                          <div
                            key={inq.id}
                            className="rounded-lg border overflow-hidden transition-all duration-200 border-slate-100 bg-slate-50/70"
                          >
                            {/* ── Card header (handled — muted styling) ── */}
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setExpandedInquiries(prev => { const s = new Set(prev); isExpanded ? s.delete(inq.id) : s.add(inq.id); return s; });
                                setExpandedArticle(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setExpandedInquiries(prev => { const s = new Set(prev); isExpanded ? s.delete(inq.id) : s.add(inq.id); return s; });
                                  setExpandedArticle(null);
                                }
                              }}
                              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors cursor-pointer hover:bg-slate-100/50`}
                            >
                              {/* Desaturated icon */}
                              <div className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center bg-slate-100">
                                <span className="text-slate-300" style={{ fontSize: 10 }}>{style.icon}</span>
                              </div>

                              {/* Label + detail (muted) */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] font-semibold leading-tight text-slate-400">{inq.label}</span>
                                  {resState?.source === 'manual' ? (
                                    <CheckSquare size={9} className="text-slate-400 shrink-0" />
                                  ) : (
                                    <span className="text-[7px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1 py-0.5 rounded">AI</span>
                                  )}
                                </div>
                                <p className="text-[10px] text-slate-300 truncate leading-tight mt-0.5">{inq.detail}</p>
                              </div>

                              {/* Toggle + chevron */}
                              <div className="flex items-center gap-1.5 shrink-0">
                                {onResolutionChange && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onResolutionChange(inq.type, {
                                        handled: false,
                                        source: 'manual',
                                        updatedAt: Date.now(),
                                      });
                                    }}
                                    className="shrink-0 p-0.5 rounded hover:bg-slate-200 transition-colors"
                                    title="Mark as active"
                                  >
                                    <CheckSquare size={12} className="text-emerald-500" />
                                  </button>
                                )}
                                <ChevronDown
                                  size={13}
                                  className={`text-slate-300 transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`}
                                />
                              </div>
                            </div>

                            {/* ── Expanded body (renders at normal contrast for readability) ── */}
                            {isExpanded && (
                              <div className="border-t border-slate-100 bg-white">
                                {guestNeedsMode === 'ai-context' && (
                                  <div className="px-3 py-2.5">
                                    {(() => {
                                      const rawItems = inq.context ?? [];
                                      const llmItems = rawItems.filter(isSubstantiveContextItem);
                                      const formItems = llmItems.length === 0
                                        ? formFields.map(f => ({
                                            section: f.roomName ? `${f.sectionTitle} — ${f.roomName}` : f.sectionTitle,
                                            text: `${f.label}: ${f.value}`,
                                            source: 'kb' as const,
                                          }))
                                        : [];
                                      const items = llmItems.length > 0 ? llmItems : formItems;
                                      const isGreeting = inq.needsKbSearch === false;

                                      if (isGreeting) return (
                                        <p className="text-[10px] text-slate-400 italic">No additional context needed.</p>
                                      );
                                      if (items.length === 0) return (
                                        <p className="text-[10px] text-slate-400 italic">No info on file for this topic.</p>
                                      );

                                      const sections = items.reduce<Record<string, typeof items>>((acc, item) => {
                                        (acc[item.section] ??= []).push(item);
                                        return acc;
                                      }, {});
                                      return (
                                        <div className="space-y-2">
                                          {Object.entries(sections).map(([section, sectionItems]) => (
                                            <div key={section}>
                                              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{section}</p>
                                              <div className="space-y-0.5">
                                                {sectionItems.map((item, i) => (
                                                  <div key={i} className="flex gap-1.5 items-start">
                                                    <span className="text-slate-300 shrink-0 leading-none mt-[3px]">•</span>
                                                    <span className={`text-[11px] leading-snug flex-1 ${item.source === 'ai' ? 'text-slate-400 italic' : 'text-slate-600'}`}>
                                                      {item.text}
                                                    </span>
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>)}
          </div>
        </div>
      </div>
    </div>
  );
}

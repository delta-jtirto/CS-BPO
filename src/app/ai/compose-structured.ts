/**
 * compose-structured — shared primitive for SmartReply v2 and (Phase C) auto-reply.
 *
 * One LLM call that returns a coherent guest reply PRE-SEGMENTED by
 * inquiry_key (stable content-derived key from InquiryDetector.deriveInquiryKey),
 * plus routing signals (outcome, risk_score, escalate_topics, promised_actions)
 * that the auto-reply router already consumes.
 *
 * This module is pure IO — no React, no Supabase. Callers:
 *   - useComposeStructured (SmartReply panel)
 *   - useAutoReply (Phase C — draft/send routing)
 *
 * JSON parse is defensive: markdown fences stripped, unescaped newlines
 * inside string values fixed, unknown inquiry_keys dropped, missing
 * sections for expected keys back-filled as holdbacks with covered=false.
 */
import { composeReplyAI } from './api-client';
import {
  interpolate,
  resolvePrompt,
  resolveModel,
  resolveTemperature,
  resolveMaxTokens,
  type PromptOverrides,
} from './prompts';
import type { DetectedInquiry } from '../components/inbox/InquiryDetector';

// ─── Types ────────────────────────────────────────────────

export type StructuredOutcome = 'answered' | 'partial' | 'escalate';

export interface PromisedAction {
  action:
    | 'dispatch_maintenance'
    | 'check_availability'
    | 'confirm_booking_detail'
    | 'contact_vendor'
    | 'custom';
  summary: string;
  urgency: 'normal' | 'high';
  confidence: number;
}

export interface StructuredReplySection {
  /** Echoes the `inquiryKey` from the input DetectedInquiry[]. Stable across
   *  reclassifications so downstream draft caches can match sections to
   *  inquiries by content, not by position. */
  inquiryKey: string;
  text: string;
  covered: boolean;
  confidence: number;
}

export interface StructuredReply {
  greeting: string;
  sections: StructuredReplySection[];
  closing: string;
  outcome: StructuredOutcome;
  riskScore: number;
  escalateTopics: string[];
  promisedActions: PromisedAction[];
  reason: string;
  /** Post-processing banned-phrase scan flag. Never from the LLM. */
  safetyFlagged?: boolean;
}

// ─── Banned phrases (mirrors useAutoReply BASE_BANNED_PHRASES) ─
// Kept in sync with the list in useAutoReply.ts. When Phase C lands, the
// useAutoReply source will import this constant instead of duplicating.

export const BASE_BANNED_PHRASES = [
  'right away',
  'immediately',
  'within the hour',
  "i've arranged",
  'i have arranged',
  'very soon',
  'at once',
];

export function buildBannedPhraseRegex(extraPhrases: string[] = []): RegExp {
  const all = [...BASE_BANNED_PHRASES, ...extraPhrases];
  const escaped = all.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('|'), 'i');
}

// ─── Inquiry list rendering ──────────────────────────────

function renderInquiriesList(inquiries: DetectedInquiry[]): string {
  if (inquiries.length === 0) return '(none — reply with greeting + brief acknowledgement + closing only)';
  return inquiries
    .map(inq => {
      const handled = inq.status === 'handled' ? ' [already handled in earlier reply]' : '';
      return `- inquiry_key: ${inq.inquiryKey}\n  label: ${inq.label}\n  detail: ${inq.detail}${handled}`;
    })
    .join('\n');
}

// ─── JSON parsing (defensive) ────────────────────────────

function stripCodeFences(s: string): string {
  const t = s.trim();
  if (!t.startsWith('```')) return t;
  return t.replace(/^```[a-z]*\s*/i, '').replace(/\s*```[\s\S]*$/, '').trim();
}

function fixUnescapedNewlinesInStrings(s: string): string {
  // Models sometimes emit raw newlines inside JSON string values. Escape
  // them so JSON.parse succeeds. Only operates within double-quoted runs.
  return s.replace(/"(?:[^"\\]|\\.)*"/gs, m =>
    m.replace(/\n/g, '\\n').replace(/\r/g, ''),
  );
}

function clampNumber(n: unknown, min: number, max: number, fallback: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parseStructuredJSON(raw: string): StructuredReply | null {
  try {
    const stripped = stripCodeFences(raw);
    const objStart = stripped.indexOf('{');
    const objEnd = stripped.lastIndexOf('}');
    if (objStart === -1 || objEnd <= objStart) return null;
    const slice = stripped.slice(objStart, objEnd + 1);
    const parsed = JSON.parse(fixUnescapedNewlinesInStrings(slice)) as Record<string, unknown>;

    const greeting = typeof parsed.greeting === 'string' ? parsed.greeting : '';
    const closing = typeof parsed.closing === 'string' ? parsed.closing : '';
    const outcomeRaw = parsed.outcome;
    const outcome: StructuredOutcome =
      outcomeRaw === 'answered' || outcomeRaw === 'partial' || outcomeRaw === 'escalate'
        ? outcomeRaw
        : 'escalate';

    const sectionsRaw = Array.isArray(parsed.sections) ? parsed.sections : [];
    const sections: StructuredReplySection[] = sectionsRaw
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .map(s => ({
        inquiryKey: typeof s.inquiry_key === 'string' ? s.inquiry_key : '',
        text: typeof s.text === 'string' ? s.text : '',
        covered: s.covered === true,
        confidence: clampNumber(s.confidence, 0, 1, 0.5),
      }))
      .filter(s => s.inquiryKey.length > 0 && s.text.trim().length > 0);

    const escalateTopicsRaw = Array.isArray(parsed.escalate_topics) ? parsed.escalate_topics : [];
    const escalateTopics = escalateTopicsRaw.map(String).filter(Boolean);

    const promisedRaw = Array.isArray(parsed.promised_actions) ? parsed.promised_actions : [];
    const validActions = new Set([
      'dispatch_maintenance',
      'check_availability',
      'confirm_booking_detail',
      'contact_vendor',
      'custom',
    ]);
    const promisedActions: PromisedAction[] = promisedRaw
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
      .filter(a => typeof a.action === 'string' && validActions.has(a.action as string))
      .filter(a => typeof a.summary === 'string')
      .map(a => ({
        action: a.action as PromisedAction['action'],
        summary: String(a.summary).slice(0, 200),
        urgency: a.urgency === 'high' ? 'high' : 'normal',
        confidence: clampNumber(a.confidence, 0, 1, 0.5),
      }));

    return {
      greeting,
      sections,
      closing,
      outcome,
      riskScore: clampNumber(parsed.risk_score, 0, 10, 5),
      escalateTopics,
      promisedActions,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    };
  } catch {
    return null;
  }
}

function fallbackReply(inquiries: DetectedInquiry[], reason: string): StructuredReply {
  return {
    greeting: '',
    sections: inquiries.map(inq => ({
      inquiryKey: inq.inquiryKey,
      text: '',
      covered: false,
      confidence: 0,
    })),
    closing: '',
    outcome: 'escalate',
    riskScore: 5,
    escalateTopics: inquiries.map(i => i.label),
    promisedActions: [],
    reason,
  };
}

/**
 * Back-fill sections for expected inquiry keys the LLM skipped, and drop
 * sections whose key isn't in the expected list. Keeps the order of the
 * expected inquiries so the UI can render cards predictably.
 *
 * LLMs regularly invent their own `inquiry_key` values instead of echoing
 * ours (seen in the wild even with explicit prompt instructions). We try
 * three match strategies in order:
 *   1. Exact key match — the happy path.
 *   2. Positional match — if the LLM returned the same number of sections
 *      in the same order, pair by index. Low risk: the prompt asks for
 *      one section per inquiry in the listed order.
 *   3. Empty fallback — surface an empty section so the UI still renders
 *      a card for the inquiry rather than silently dropping it.
 * The returned section always carries OUR inquiryKey so downstream keying
 * is consistent with the inquiry list.
 */
function alignSectionsToInquiries(
  sections: StructuredReplySection[],
  inquiries: DetectedInquiry[],
): StructuredReplySection[] {
  const byKey = new Map(sections.map(s => [s.inquiryKey, s]));
  const samePositionalCount = sections.length === inquiries.length;
  return inquiries.map((inq, idx) => {
    const byKeyMatch = byKey.get(inq.inquiryKey);
    if (byKeyMatch) return { ...byKeyMatch, inquiryKey: inq.inquiryKey };
    if (samePositionalCount && sections[idx]) {
      return { ...sections[idx], inquiryKey: inq.inquiryKey };
    }
    return {
      inquiryKey: inq.inquiryKey,
      text: '',
      covered: false,
      confidence: 0,
    };
  });
}

// ─── Main entrypoints ────────────────────────────────────

export interface ComposeStructuredOptions {
  hostName: string;
  hostTone: string;
  channel: string;
  channelHint: string;
  guestFirstName: string;
  agentName: string;
  language: string;
  conversationHistory: string;
  kbContext: string;
  inquiries: DetectedInquiry[];
  /** Agent's typed reply-box text — passed only when the user chose
   *  "Incorporate my draft". Empty string / undefined = fresh compose. */
  agentDraftHint?: string;
  promptOverrides?: PromptOverrides;
  bannedPhrasesExtra?: string[];
  signal?: AbortSignal;
}

export async function composeStructuredReply(opts: ComposeStructuredOptions): Promise<StructuredReply> {
  const overrides = opts.promptOverrides ?? {};
  const userPrompt = interpolate(resolvePrompt('compose_structured', 'user', overrides), {
    hostName: opts.hostName,
    hostTone: opts.hostTone,
    channel: opts.channel,
    channelHint: opts.channelHint,
    guestFirstName: opts.guestFirstName,
    agentName: opts.agentName,
    language: opts.language,
    conversationHistory: opts.conversationHistory,
    inquiriesList: renderInquiriesList(opts.inquiries),
    agentDraftHint: opts.agentDraftHint?.trim() ? opts.agentDraftHint.trim() : 'none',
    propertyKB: opts.kbContext,
  });

  const raw = await composeReplyAI({
    systemPrompt: resolvePrompt('compose_structured', 'system', overrides),
    userPrompt,
    model: resolveModel('compose_structured', overrides),
    temperature: resolveTemperature('compose_structured', overrides),
    maxTokens: resolveMaxTokens('compose_structured', overrides),
    signal: opts.signal,
  });

  const parsed = parseStructuredJSON(raw.text);
  if (!parsed) {
    console.warn('[compose-structured] JSON parse failed — raw response head:', raw.text.slice(0, 300));
    return fallbackReply(opts.inquiries, 'JSON parse failure — fallback to escalate');
  }

  const aligned: StructuredReply = {
    ...parsed,
    sections: alignSectionsToInquiries(parsed.sections, opts.inquiries),
  };

  // Banned-phrase scan across assembled text. Any hit flags the whole
  // reply for draft-review treatment; downstream (useAutoReply) uses this
  // to force draft mode even when autoReplyMode === 'auto'.
  const assembled = [
    aligned.greeting,
    ...aligned.sections.filter(s => s.text.trim().length > 0).map(s => s.text),
    aligned.closing,
  ].join('\n');
  const bannedRegex = buildBannedPhraseRegex(opts.bannedPhrasesExtra ?? []);
  if (bannedRegex.test(assembled)) {
    aligned.safetyFlagged = true;
  }

  // Risk-gate override (same rule as useAutoReply STEP 5b): score>=8 forces
  // escalate regardless of what the LLM returned.
  if (aligned.riskScore >= 8) {
    aligned.outcome = 'escalate';
  }

  return aligned;
}

export interface ComposeStructuredSectionOptions {
  hostName: string;
  hostTone: string;
  guestFirstName: string;
  agentName: string;
  language: string;
  conversationHistory: string;
  kbContext: string;
  inquiry: DetectedInquiry;
  /** Already-drafted other sections, rendered as read-only context so the
   *  regenerated section's voice matches the surrounding reply. Empty array
   *  is fine (e.g. first-open single-inquiry regenerate). */
  otherSections: Array<{ inquiryKey: string; label: string; text: string }>;
  /** Optional agent directive ("mention the pool closes at 10pm"). */
  agentNote?: string;
  promptOverrides?: PromptOverrides;
  signal?: AbortSignal;
}

function renderOtherSections(
  others: ComposeStructuredSectionOptions['otherSections'],
): string {
  if (others.length === 0) return '(none — this is the only section)';
  return others
    .filter(s => s.text.trim().length > 0)
    .map(s => `- ${s.label}:\n${s.text.trim()}`)
    .join('\n\n') || '(none — this is the only section)';
}

export async function composeStructuredReplySection(
  opts: ComposeStructuredSectionOptions,
): Promise<StructuredReplySection> {
  const overrides = opts.promptOverrides ?? {};
  const userPrompt = interpolate(resolvePrompt('compose_structured_section', 'user', overrides), {
    hostName: opts.hostName,
    hostTone: opts.hostTone,
    guestFirstName: opts.guestFirstName,
    agentName: opts.agentName,
    language: opts.language,
    conversationHistory: opts.conversationHistory,
    inquiryKey: opts.inquiry.inquiryKey,
    inquiryLabel: opts.inquiry.label,
    inquiryDetail: opts.inquiry.detail,
    otherSections: renderOtherSections(opts.otherSections),
    agentNote: opts.agentNote?.trim() ? opts.agentNote.trim() : 'none',
    propertyKB: opts.kbContext,
  });

  const raw = await composeReplyAI({
    systemPrompt: resolvePrompt('compose_structured_section', 'system', overrides),
    userPrompt,
    model: resolveModel('compose_structured_section', overrides),
    temperature: resolveTemperature('compose_structured_section', overrides),
    maxTokens: resolveMaxTokens('compose_structured_section', overrides),
    signal: opts.signal,
  });

  try {
    const stripped = stripCodeFences(raw.text);
    const objStart = stripped.indexOf('{');
    const objEnd = stripped.lastIndexOf('}');
    if (objStart === -1 || objEnd <= objStart) throw new Error('no JSON block');
    const parsed = JSON.parse(
      fixUnescapedNewlinesInStrings(stripped.slice(objStart, objEnd + 1)),
    ) as Record<string, unknown>;
    return {
      inquiryKey: opts.inquiry.inquiryKey,
      text: typeof parsed.text === 'string' ? parsed.text : '',
      covered: parsed.covered === true,
      confidence: clampNumber(parsed.confidence, 0, 1, 0.5),
    };
  } catch (err) {
    console.warn('[compose-structured-section] JSON parse failed:', err, 'raw:', raw.text.slice(0, 300));
    return {
      inquiryKey: opts.inquiry.inquiryKey,
      text: '',
      covered: false,
      confidence: 0,
    };
  }
}

/**
 * Assemble a structured reply into plain text (greeting + sections + closing).
 * Skipped sections (empty text) are omitted. Used by the SmartReply Insert
 * button and by useAutoReply's send path in Phase C.
 */
export function assembleStructuredReply(reply: {
  greeting: string;
  sections: Array<{ text: string; isSkipped?: boolean }>;
  closing: string;
}): string {
  const parts: string[] = [];
  if (reply.greeting.trim()) parts.push(reply.greeting.trim());
  for (const s of reply.sections) {
    if (s.isSkipped) continue;
    const t = s.text.trim();
    if (t.length > 0) parts.push(t);
  }
  if (reply.closing.trim()) parts.push(reply.closing.trim());
  return parts.join('\n\n');
}

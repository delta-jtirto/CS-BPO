import { detectInquiries } from '@/app/components/inbox/InquiryDetector';
import type { Message } from '@/app/data/types';
import type { HostSettings } from '@/app/context/AppContext';

// ─── SLA Computation ─────────────────────────────────────────

export interface EscalationOverride {
  level: 'warning' | 'urgent';
  setAt: number; // epoch ms
}

export type SLAResult =
  | { status: 'resolved'; sla: null; resolved: true }
  | { status: 'urgent' | 'warning' | 'normal' | 'stale'; sla: number; resolved: false };

/**
 * Compute SLA from the last guest message timestamp.
 *
 * Priority order:
 * 1. Resolved (if no guest message after resolvedAt)
 * 2. Escalation override (if no guest message after setAt — human judgment valid)
 * 3. Computed from timestamp vs host thresholds
 *
 * Core rule: if lastGuestMessageAt > override.setAt, the world moved — recompute.
 */
export function computeSLA(
  lastGuestMessageAt: number | null,
  _hostSettings?: HostSettings | null,
  resolvedAt?: number | null,
  escalationOverride?: EscalationOverride | null,
): SLAResult {
  // No guest messages yet — normal, no SLA
  if (!lastGuestMessageAt) {
    return { status: 'normal', sla: 0, resolved: false };
  }

  const now = Date.now();

  // 1. Resolved check — but auto-reopen if guest replied after resolution
  if (resolvedAt && lastGuestMessageAt <= resolvedAt) {
    return { status: 'resolved', sla: null, resolved: true };
  }

  // 2. Escalation override — valid only if no guest message after it was set
  if (escalationOverride && lastGuestMessageAt <= escalationOverride.setAt) {
    const elapsed = now - escalationOverride.setAt;
    return { status: escalationOverride.level, sla: elapsed, resolved: false };
  }

  // 3. Compute from timestamp
  const elapsed = now - lastGuestMessageAt;
  const minutes = elapsed / 60_000;

  // Thresholds (could be per-host from hostSettings in future)
  if (minutes > 1440) return { status: 'stale', sla: elapsed, resolved: false }; // > 24h
  if (minutes > 120) return { status: 'urgent', sla: elapsed, resolved: false };  // > 2h
  if (minutes > 30) return { status: 'warning', sla: elapsed, resolved: false };  // > 30min
  return { status: 'normal', sla: elapsed, resolved: false };
}

/**
 * Check if a resolved thread should auto-reopen (guest replied after resolution).
 */
export function shouldAutoReopen(resolvedAt: number | null | undefined, lastGuestMessageAt: number | null): boolean {
  if (!resolvedAt || !lastGuestMessageAt) return false;
  return lastGuestMessageAt > resolvedAt;
}

/**
 * Check if an escalation override is stale (guest replied after it was set).
 */
export function isEscalationStale(override: EscalationOverride | null | undefined, lastGuestMessageAt: number | null): boolean {
  if (!override || !lastGuestMessageAt) return false;
  return lastGuestMessageAt > override.setAt;
}

// ─── SLA Display Formatting ──────────────────────────────────

/** Format SLA milliseconds to relative time: "just now", "2m", "1h 23m", "3d" */
export function formatSLARelative(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  if (hours < 24) return remainMin > 0 ? `${hours}h ${remainMin}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// ─── Tag Computation ─────────────────────────────────────────

/** Tag cache — keyed by threadId, recomputed when message count changes */
const tagCache = new Map<string, { tags: string[]; messageCount: number }>();

/**
 * Compute tags from messages using InquiryDetector.
 * Only for detail view — never from thread list preview.
 * Cached per threadId, recomputed when message count changes.
 */
export function computeTags(threadId: string, messages: Message[]): string[] {
  const guestMessages = messages.filter(m => m.sender === 'guest').map(m => m.text);
  if (guestMessages.length === 0) return [];

  const cached = tagCache.get(threadId);
  if (cached && cached.messageCount === messages.length) {
    return cached.tags;
  }

  const inquiries = detectInquiries(guestMessages, [], '');
  const tags = [...new Set(inquiries.flatMap(i => i.relevantTags))];
  tagCache.set(threadId, { tags, messageCount: messages.length });
  return tags;
}

/** Clear tag cache (for testing or reset) */
export function clearTagCache() {
  tagCache.clear();
}

// ─── Language Detection ──────────────────────────────────────

interface LanguageCache {
  language: string;
  detectedFromGuestMessage: boolean;
}

const languageCache = new Map<string, LanguageCache>();

/**
 * Detect language from the first guest message. Memoized on threadId alone.
 * Only re-detects if previous detection wasn't from a guest message and one now exists.
 */
export function detectLanguage(threadId: string, messages: Message[]): string {
  const cached = languageCache.get(threadId);

  // If we already detected from a guest message, never re-detect
  if (cached?.detectedFromGuestMessage) return cached.language;

  const firstGuestMsg = messages.find(m => m.sender === 'guest');
  if (!firstGuestMsg) {
    // No guest message yet — cache as default, allow re-detection later
    if (!cached) {
      languageCache.set(threadId, { language: 'en', detectedFromGuestMessage: false });
    }
    return cached?.language || 'en';
  }

  const text = firstGuestMsg.text;
  let lang = 'en';

  // Simple heuristic: detect CJK, Arabic, Cyrillic, Korean, Thai
  if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(text)) lang = 'ja';
  else if (/[\uAC00-\uD7AF]/.test(text)) lang = 'ko';
  else if (/[\u4E00-\u9FFF]/.test(text) && !/[\u3040-\u309F]/.test(text)) lang = 'zh';
  else if (/[\u0600-\u06FF]/.test(text)) lang = 'ar';
  else if (/[\u0400-\u04FF]/.test(text)) lang = 'ru';
  else if (/[\u0E00-\u0E7F]/.test(text)) lang = 'th';

  languageCache.set(threadId, { language: lang, detectedFromGuestMessage: true });
  return lang;
}

export function clearLanguageCache() {
  languageCache.clear();
}

// ─── Helpers ─────────────────────────────────────────────────

/** Find the timestamp of the last guest message in a list */
export function getLastGuestMessageAt(messages: Message[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].sender === 'guest') return messages[i].createdAt;
  }
  return null;
}

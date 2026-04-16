/**
 * Inquiry Resolution Utilities — Pure functions for the three-layer
 * hybrid resolution system. No React dependency.
 *
 * Layer 1 (AI metadata): handled by useAutoReply custom events
 * Layer 2 (Agent reply heuristic): detectAgentCoverage()
 * Layer 3 (Manual toggle): handled by UI callbacks
 * Re-open detection: detectReopenedInquiries()
 * Reconstruction: reconstructResolutionState()
 */

import type { DetectedInquiry } from './InquiryDetector';
import { stem, extractKeywords } from './InquiryDetector';
import { parseThreadStatus, type Message, type InquiryResolutionMap } from '../../data/types';

// ─── Gratitude filter ─────────────────────────────────────
// Matches messages that confirm resolution rather than raise new issues.
// Applied to raw text BEFORE stemming (stop words strip "thanks"/"great"
// from keyword extraction, but we need to detect the intent here).
const GRATITUDE_RE = /\b(thanks?|thank\s*you|great|perfect|awesome|sounds?\s*good|no\s*worries|got\s*it|appreciate|wonderful|excellent|works?\s*(now|fine|great)?)\b/i;

/** Jaccard similarity: |A ∩ B| / |A ∪ B| */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Layer 2: Agent Reply Heuristic ───────────────────────

const JACCARD_THRESHOLD = 0.3;

/**
 * Check which active inquiries an agent's reply likely covers,
 * using Jaccard similarity on stemmed keyword sets.
 *
 * Returns inquiry types with overlap >= threshold.
 * Skips if the reply is purely a gratitude/confirmation message.
 */
export function detectAgentCoverage(
  replyText: string,
  activeInquiries: DetectedInquiry[],
): string[] {
  // Skip gratitude-only replies (confirmations, not resolutions)
  if (GRATITUDE_RE.test(replyText) && replyText.trim().split(/\s+/).length <= 8) {
    return [];
  }

  // Extract and stem keywords from the agent's reply
  const replyKeywords = new Set(extractKeywords(replyText, 'general'));
  if (replyKeywords.size === 0) return [];

  const covered: string[] = [];
  for (const inq of activeInquiries) {
    // Skip greetings/pleasantries — they shouldn't be "handled"
    if (inq.needsKbSearch === false) continue;

    const inquiryKeywords = new Set(inq.keywords);
    const score = jaccard(replyKeywords, inquiryKeywords);
    if (score >= JACCARD_THRESHOLD) {
      covered.push(inq.type);
    }
  }

  return covered;
}

// ─── Re-open Detection ────────────────────────────────────

const MIN_KEYWORD_MATCHES = 2;

/**
 * Check if a new guest message re-raises a previously handled inquiry.
 * Requires 2+ keyword matches AND the message is NOT a gratitude pattern.
 */
export function detectReopenedInquiries(
  messageText: string,
  handledInquiryTypes: string[],
  inquiriesByType: Record<string, DetectedInquiry>,
): string[] {
  // Gratitude messages don't re-open (e.g. "wifi works great thanks")
  if (GRATITUDE_RE.test(messageText)) return [];

  const messageKeywords = new Set(extractKeywords(messageText, 'general'));
  if (messageKeywords.size === 0) return [];

  const reopened: string[] = [];
  for (const type of handledInquiryTypes) {
    const inq = inquiriesByType[type];
    if (!inq) continue;

    // Count keyword matches (not Jaccard — we want absolute overlap count)
    let matchCount = 0;
    for (const kw of inq.keywords) {
      if (messageKeywords.has(kw)) matchCount++;
    }

    if (matchCount >= MIN_KEYWORD_MATCHES) {
      reopened.push(type);
    }
  }

  return reopened;
}

// ─── Reconstruction from System Messages ──────────────────

/**
 * Reconstruct inquiry resolution state from system messages when
 * switching tickets. Scans from newest to oldest, uses the first
 * relevant status to set handled/active for all inquiry types.
 *
 * Pattern matching:
 *   "AI handled" / "Agent followed up" → all handled
 *   "Follow-up needed — topics" → non-escalated types handled
 *   "Routed to team" / "Silently routed" → all active
 */
export function reconstructResolutionState(
  messages: Message[],
  inquiryTypes: string[],
): InquiryResolutionMap {
  if (inquiryTypes.length === 0) return {};

  // Scan system messages newest-first
  const systemMsgs = messages
    .filter(m => m.sender === 'system')
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  for (const msg of systemMsgs) {
    const status = parseThreadStatus(msg.text);
    const t = msg.text.toLowerCase();

    if (status === 'ai-handled' || t.includes('agent followed up')) {
      // All inquiries were resolved
      const map: InquiryResolutionMap = {};
      for (const type of inquiryTypes) {
        map[type] = { handled: true, source: 'ai', updatedAt: msg.createdAt ?? Date.now() };
      }
      return map;
    }

    if (status === 'partial') {
      // Parse escalated topics from "Follow-up needed — topic1, topic2"
      const dashIdx = msg.text.indexOf('—');
      const topicStr = dashIdx >= 0 ? msg.text.slice(dashIdx + 1).trim() : '';
      const escalatedTopics = topicStr
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);

      const map: InquiryResolutionMap = {};
      for (const type of inquiryTypes) {
        // If this inquiry type fuzzy-matches an escalated topic, it stays active
        const isEscalated = escalatedTopics.some(topic =>
          topic.includes(type) ||
          type.includes(topic) ||
          stem(topic) === stem(type)
        );
        if (!isEscalated) {
          map[type] = { handled: true, source: 'ai', updatedAt: msg.createdAt ?? Date.now() };
        }
      }
      return map;
    }

    if (status === 'handed-off') {
      // Everything was escalated — all stay active
      return {};
    }
  }

  // No relevant system messages — all active (default)
  return {};
}

// ─── Fuzzy Topic Matching (for Layer 1 partial outcomes) ──

/**
 * Given an array of escalate_topics (free-text strings from AI output)
 * and an array of inquiry types, return the types that are NOT covered
 * by any escalated topic (i.e., the ones the AI handled).
 */
export function getHandledTypesFromPartial(
  allTypes: string[],
  escalateTopics: string[],
): string[] {
  const normalizedEscalated = escalateTopics.map(t => t.toLowerCase().trim());

  return allTypes.filter(type => {
    const typeLower = type.toLowerCase();
    const typeStemmed = stem(typeLower);
    // Check if any escalated topic matches this inquiry type
    return !normalizedEscalated.some(topic => {
      const topicStemmed = stem(topic);
      return topic.includes(typeLower) ||
        typeLower.includes(topic) ||
        topicStemmed === typeStemmed;
    });
  });
}

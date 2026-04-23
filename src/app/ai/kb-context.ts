import type { OnboardingSection } from '../data/onboarding-template';
import type {
  KBEntry,
  KnowledgeChunk,
  KnowledgeKind,
} from '../data/types';

/**
 * Build AI context from the canonical `knowledge_chunks` store.
 *
 * Output: a flat text block grouped by `kind`, visibility-filtered for
 * guest-facing prompts. The grouped shape lets the LLM reason about
 * WHERE a fact comes from ("this is a property fact vs an internal SOP")
 * instead of treating it all as one flat wall of text.
 *
 * Since Step 6 of the single-source-of-truth refactor, this module reads
 * ONLY from `knowledge_chunks`. The old derivation helpers
 * (`deriveChunksFromLegacy`, `makeFactChunk`, `guessKindFromEntry`) were
 * deleted — every writer now lands data in the chunk store atomically:
 *   - setOnboardingField / setOnboardingBulk → property_fact chunks
 *   - syncFaqsToChunks → faq chunks
 *   - addKBEntry → manual chunks
 *   - import-router → doc-ingest chunks of every kind
 * Legacy arguments `onboardingData` / `manualKBEntries` are retained on
 * the `buildPropertyContext` signature for back-compat with existing
 * callers but are no longer read. They can be dropped in a follow-up.
 */

const KIND_SECTION_HEADERS: Record<KnowledgeKind, string> = {
  property_fact: 'Property Facts',
  faq: 'FAQs',
  reply_template: 'Reply Templates',
  sop: 'Operating Procedures',
  urgency_rule: 'Urgency & Escalation Rules',
  workflow: 'Workflows',
};

/** Render a grouped-by-kind, visibility-filtered property context string. */
export function buildPropertyContext(
  propId: string,
  propName: string,
  _onboardingData: Record<string, Record<string, string>>,
  _formTemplate: OnboardingSection[],
  _roomNames: string[],
  _manualKBEntries: KBEntry[],
  options?: {
    /** Canonical knowledge chunk store — the ONLY real input now. */
    knowledgeChunks?: KnowledgeChunk[];
    /** Opt-in to include internal-only chunks (SOPs, urgency rules, etc.).
     *  DEFAULT is false — matches the pre-pivot behavior where `hostHidden`
     *  sections were always excluded. Set true for internal triage prompts
     *  like classify_inquiry that benefit from seeing escalation rules. */
    includeInternal?: boolean;
    /** Host id for scoping host-global chunks. Required when knowledgeChunks
     *  contains chunks with `propId=null`. */
    hostId?: string;
  },
): string {
  // When no property is resolved, emit a clear sentinel rather than an
  // empty `[Property: ]` header that the LLM could misread as "property
  // exists but has no data".
  if (!propName) {
    return '[No property selected — property-specific knowledge base unavailable. Use general hospitality knowledge tagged source:ai as needed.]';
  }

  // Scope the chunk store to this property (prop-specific + host-global
  // inherited), active status only, and optionally filter out internal.
  const scoped = (options?.knowledgeChunks || []).filter(c => {
    if (c.status !== 'active') return false;
    if (c.propId && c.propId !== propId) return false;
    if (!c.propId && options?.hostId && c.hostId !== options.hostId) return false;
    return true;
  });

  const visible = options?.includeInternal
    ? scoped
    : scoped.filter(c => c.visibility === 'guest_facing');

  // Dedupe by slotKey — property_fact chunks with the same slot mean a
  // user override exists on top of a doc-ingest chunk; the latest wins
  // (chunks passed in already honor the override layer convention).
  const bySlot = new Map<string, KnowledgeChunk>();
  const freeform: KnowledgeChunk[] = [];
  for (const c of visible) {
    if (c.slotKey) {
      const existing = bySlot.get(c.slotKey);
      if (!existing || new Date(c.updatedAt) >= new Date(existing.updatedAt)) {
        bySlot.set(c.slotKey, c);
      }
    } else {
      freeform.push(c);
    }
  }
  const all = [...bySlot.values(), ...freeform];

  // Group by kind
  const byKind = new Map<KnowledgeKind, KnowledgeChunk[]>();
  for (const c of all) {
    const bucket = byKind.get(c.kind) ?? [];
    bucket.push(c);
    byKind.set(c.kind, bucket);
  }

  const lines: string[] = [`[Property: ${propName}]`];
  const kindOrder: KnowledgeKind[] = [
    'property_fact',
    'faq',
    'urgency_rule',
    'sop',
    'reply_template',
    'workflow',
  ];

  for (const kind of kindOrder) {
    const bucket = byKind.get(kind);
    if (!bucket || bucket.length === 0) continue;
    lines.push(`\n[${KIND_SECTION_HEADERS[kind]}]`);

    if (kind === 'property_fact') {
      // Sub-group facts by section so the LLM sees "Property Facts → Wi-Fi"
      // grouping it's used to. Room facts get their own sub-header per room.
      const bySection = new Map<string, KnowledgeChunk[]>();
      for (const c of bucket) {
        const sectionTitle = (c.structured?.sectionTitle as string) || 'General';
        const roomName = (c.structured?.roomName as string) || '';
        const key = roomName ? `${roomName} — ${sectionTitle}` : sectionTitle;
        const list = bySection.get(key) ?? [];
        list.push(c);
        bySection.set(key, list);
      }
      for (const [sectionKey, facts] of bySection) {
        lines.push(`  ${sectionKey}:`);
        for (const f of facts) {
          const label = (f.structured?.fieldLabel as string) || f.title;
          lines.push(`    ${label}: ${f.body.replace(/\n/g, ' ')}`);
        }
      }
      continue;
    }

    if (kind === 'faq') {
      for (const c of bucket) {
        const q = (c.structured?.question as string) || c.title;
        const a = (c.structured?.answer as string) || c.body;
        lines.push(`  Q: ${q}`);
        lines.push(`  A: ${a.replace(/\n/g, ' ')}`);
      }
      continue;
    }

    // Generic rendering for the remaining kinds.
    for (const c of bucket) {
      lines.push(`  ${c.title}: ${c.body.replace(/\n/g, ' ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Build a TOON-format KB string for use in the classify-inquiry prompt.
 * Kept for the few callers that still pass legacy `KBEntry[]` lists.
 * New code should pass `KnowledgeChunk[]` via `buildPropertyContext`.
 */
export function buildKBToonForClassify(entries: KBEntry[]): string {
  if (entries.length === 0) return '(no knowledge base entries)';
  const lines = ['kb_entries{scope,topic,content}:'];
  for (const e of entries) {
    const scope = e.roomId ? 'room' : 'property';
    const content = e.content.replace(/\n/g, ' ').replace(/"/g, "'");
    lines.push(`  ${scope},${e.title},"${content}"`);
  }
  return lines.join('\n');
}

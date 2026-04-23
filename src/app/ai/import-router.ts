import type {
  KnowledgeChunk,
  KnowledgeKind,
  ChunkVisibility,
  IngestedDocument,
} from '../data/types';
import { defaultVisibilityForKind } from '../data/types';
import type { OnboardingSection } from '../data/onboarding-template';
import type { NormalizedDocument, NormalizedSection } from '../lib/doc-normalize';
import { stableHash } from '../lib/storage';
import { importDocumentAI } from './api-client';
import type { PromptOverrides } from './prompts';
import { resolvePrompt, resolveModel, interpolate } from './prompts';

/**
 * Stage B of the ingest pipeline: pass each normalized section through the
 * AI router prompt, validate the response, and mint KnowledgeChunks with
 * provenance stamped in.
 *
 * Determinism notes:
 *   - property_fact slotKeys are enum-constrained via the ONBOARDING_SECTIONS
 *     schema injected into the prompt. If the router produces a slotKey that
 *     doesn't match the schema, we null it out (the chunk stays but becomes
 *     "unmapped" — surfaced for human review).
 *   - Free-form kinds (faq/sop/urgency_rule/reply_template/workflow) never
 *     get a slotKey — re-ingest uses document-scoped archive-and-replace.
 */

export interface RouterChunkDraft {
  kind: KnowledgeKind;
  title: string;
  body: string;
  originalText?: string;
  structured?: Record<string, unknown>;
  slotKey?: string | null;
  confidence?: number;
  visibility?: ChunkVisibility;
}

export interface IngestContext {
  hostId: string;
  propId: string | null;
  roomNames: string[];
  promptOverrides: PromptOverrides;
  /** Optional AbortSignal — when aborted, the router stops classifying
   *  remaining sections and the in-flight AI call cancels, preventing
   *  further tokens from being spent. */
  signal?: AbortSignal;
}

/** Error thrown when the user cancels an in-progress ingest. Callers can
 *  distinguish a user-initiated cancel from a real failure so they don't
 *  show a misleading "Import failed" toast. */
export class IngestAbortedError extends Error {
  constructor() {
    super('Ingest aborted by user');
    this.name = 'IngestAbortedError';
  }
}

export interface IngestResult {
  doc: IngestedDocument;
  chunks: KnowledgeChunk[];
  /** Router-level errors per section (e.g. JSON parse failure). The section
   *  is skipped but we keep the others — partial success is better than
   *  all-or-nothing when a 7-sheet workbook has one bad sheet. */
  sectionErrors: { label: string; error: string }[];
}

const VALID_KINDS: Set<KnowledgeKind> = new Set([
  'property_fact', 'faq', 'sop', 'urgency_rule', 'reply_template', 'workflow',
]);

export async function ingestDocument(
  normalized: NormalizedDocument,
  ctx: IngestContext,
  formTemplate: OnboardingSection[],
  uploadedBy: string,
): Promise<IngestResult> {
  const docId = await stableHash(`${ctx.propId ?? 'global'}:${normalized.filename}`);
  const now = new Date().toISOString();

  const doc: IngestedDocument = {
    id: docId,
    hostId: ctx.hostId,
    propId: ctx.propId,
    filename: normalized.filename,
    contentHash: normalized.contentHash,
    uploadedAt: now,
    uploadedBy,
    sheets: normalized.sheets,
    chunkIds: [],
    status: normalized.error ? 'failed' : 'processing',
    parseError: normalized.error,
  };

  if (normalized.error) {
    return { doc, chunks: [], sectionErrors: [] };
  }

  const schema = serializeSchema(formTemplate, ctx.roomNames);
  const chunks: KnowledgeChunk[] = [];
  const sectionErrors: { label: string; error: string }[] = [];
  const validSlotKeys = buildValidSlotKeys(formTemplate, ctx.roomNames.length);

  for (const section of normalized.sections) {
    // Short-circuit the whole run on user cancel — don't start another AI
    // call (which would spend tokens) after the cancel was requested.
    if (ctx.signal?.aborted) throw new IngestAbortedError();
    try {
      const drafts = await classifySection(section, normalized.filename, schema, ctx.promptOverrides, ctx.signal);
      const sectionChunks = await draftsToChunks(drafts, {
        section,
        ctx,
        docId,
        now,
        validSlotKeys,
      });
      chunks.push(...sectionChunks);
    } catch (err) {
      // If the user cancelled mid-fetch, AbortError bubbles up here. Re-
      // throw so the outer caller sees IngestAbortedError and not "section
      // X failed to parse".
      if (ctx.signal?.aborted) throw new IngestAbortedError();
      sectionErrors.push({
        label: section.label,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  doc.chunkIds = chunks.map(c => c.id);
  doc.status = sectionErrors.length > 0
    ? (chunks.length > 0 ? 'partial' : 'failed')
    : 'ready';
  if (sectionErrors.length > 0) {
    doc.parseError = sectionErrors.map(e => `${e.label}: ${e.error}`).join('; ');
  }

  return { doc, chunks, sectionErrors };
}

// ─── AI call per section ───────────────────────────────────────────────

async function classifySection(
  section: NormalizedSection,
  docName: string,
  onboardingSchema: string,
  overrides: PromptOverrides,
  signal?: AbortSignal,
): Promise<RouterChunkDraft[]> {
  const systemPrompt = resolvePrompt('import_router', 'system', overrides);
  const userPrompt = interpolate(resolvePrompt('import_router', 'user', overrides), {
    sectionLabel: section.label,
    docName,
    onboardingSchema,
    sectionText: section.text,
  });

  const result = await importDocumentAI({
    model: resolveModel('import_router', overrides),
    systemPrompt,
    userPrompt,
    attachment: section.text,
    signal,
  });

  return parseRouterResponse(result.text);
}

function parseRouterResponse(responseText: string): RouterChunkDraft[] {
  // Find the first JSON object in the response — models sometimes include
  // backticks or a leading "here you go" despite the instruction not to.
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Router returned no JSON object');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new Error(`Router JSON parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { chunks?: unknown }).chunks)) {
    throw new Error('Router response missing chunks[] array');
  }

  const rawChunks = (parsed as { chunks: unknown[] }).chunks;
  const drafts: RouterChunkDraft[] = [];
  for (const raw of rawChunks) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const kind = r.kind;
    if (typeof kind !== 'string' || !VALID_KINDS.has(kind as KnowledgeKind)) continue;
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    const body = typeof r.body === 'string' ? r.body.trim() : '';
    if (!title || !body) continue;
    // Cap originalText at 2KB. A chatty AI can echo an entire sheet page
    // into originalText; storing hundreds of KB per row bloats the DB,
    // slows realtime, and breaks the Inspector's "raw source" preview.
    // 2KB = ~500 words, enough for verification without the bulk.
    const rawOriginalText = typeof r.originalText === 'string' ? r.originalText : undefined;
    const originalText = rawOriginalText && rawOriginalText.length > 2048
      ? rawOriginalText.slice(0, 2045) + '…'
      : rawOriginalText;
    drafts.push({
      kind: kind as KnowledgeKind,
      title,
      body,
      originalText,
      structured: typeof r.structured === 'object' && r.structured !== null
        ? (r.structured as Record<string, unknown>)
        : undefined,
      slotKey: typeof r.slotKey === 'string' ? r.slotKey : null,
      confidence: typeof r.confidence === 'number' ? r.confidence : undefined,
      visibility: r.visibility === 'internal' || r.visibility === 'guest_facing'
        ? r.visibility
        : undefined,
    });
  }
  return drafts;
}

// ─── Drafts → KnowledgeChunk with provenance ───────────────────────────

async function draftsToChunks(
  drafts: RouterChunkDraft[],
  opts: {
    section: NormalizedSection;
    ctx: IngestContext;
    docId: string;
    now: string;
    validSlotKeys: Set<string>;
  },
): Promise<KnowledgeChunk[]> {
  const { section, ctx, docId, now, validSlotKeys } = opts;
  const out: KnowledgeChunk[] = [];

  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];

    // Enforce slot-key discipline: property_fact slotKey must match the
    // schema; free-form kinds must not have a slotKey.
    let slotKey: string | undefined;
    if (d.kind === 'property_fact' && d.slotKey && validSlotKeys.has(d.slotKey)) {
      slotKey = d.slotKey;
    }

    // Pull roomId from the structured block when provided by the router.
    let roomId: string | null = null;
    if (slotKey) {
      const m = slotKey.match(/:room(\d+)$/);
      if (m) roomId = `room${m[1]}`;
    } else if (typeof d.structured?.roomIndex === 'number') {
      roomId = `room${d.structured.roomIndex}`;
    }

    const hashInput = JSON.stringify({ body: d.body, structured: d.structured ?? null });
    const chunkHash = await stableHash(hashInput);

    const visibility = d.visibility ?? defaultVisibilityForKind(d.kind);

    // Confidence — below 0.7 stages for human review per the plan.
    const lowConfidence = (d.confidence ?? 1) < 0.7;
    // Unmapped property_fact (router couldn't pin to a schema slot) also
    // goes to review so the agent can decide whether to add a field or drop.
    const unmappedFact = d.kind === 'property_fact' && !slotKey;

    const id = `chunk-${docId}-${section.label}-${i}-${chunkHash.slice(0, 8)}`
      .replace(/[^a-zA-Z0-9:_-]/g, '_');

    out.push({
      id,
      hostId: ctx.hostId,
      propId: ctx.propId,
      roomId,
      kind: d.kind,
      title: d.title,
      body: d.body,
      chunkHash,
      structured: d.structured,
      slotKey,
      isOverride: false,
      source: {
        type: 'doc_ingest',
        docId,
        docSheet: section.sheet,
        originalText: d.originalText,
        extractedAt: now,
      },
      visibility,
      status: lowConfidence || unmappedFact ? 'pending_review' : 'active',
      createdAt: now,
      updatedAt: now,
    });
  }

  return out;
}

// ─── Schema serialization + slot validation ────────────────────────────

/** Condensed schema rendering — keeps the prompt short. Only includes
 *  id/label/type/perRoom so the router can pick the right slot without
 *  drowning in placeholder prose. */
function serializeSchema(formTemplate: OnboardingSection[], roomNames: string[]): string {
  const out: string[] = [];
  for (const section of formTemplate) {
    if (section.id === 'faqs') continue; // FAQs aren't slot-mapped
    const perRoomNote = section.perRoom
      ? ` [perRoom: 0..${Math.max(0, roomNames.length - 1)}]`
      : '';
    out.push(`\n[${section.id}] ${section.title}${perRoomNote}`);
    for (const field of section.fields) {
      const typeHint = field.type === 'select' && field.options
        ? `select(${field.options.join('|')})`
        : field.type;
      out.push(`  ${field.id} (${typeHint}): ${field.label}`);
    }
  }
  return out.join('\n');
}

function buildValidSlotKeys(formTemplate: OnboardingSection[], roomCount: number): Set<string> {
  const keys = new Set<string>();
  for (const section of formTemplate) {
    if (section.id === 'faqs') continue;
    for (const field of section.fields) {
      if (section.perRoom) {
        for (let r = 0; r < Math.max(1, roomCount); r++) {
          keys.add(`property_fact:${section.id}:${field.id}:room${r}`);
        }
      } else {
        keys.add(`property_fact:${section.id}:${field.id}`);
      }
    }
  }
  return keys;
}

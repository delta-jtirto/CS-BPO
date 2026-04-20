/**
 * Runtime validators for Firestore + channel-proxy payloads.
 *
 * Why hand-rolled (not zod): zod isn't a dependency in this tree, and
 * adding one for ~4 shapes buys less than it costs in bundle size. The
 * validators here are deliberately small and uncovered by tests — they
 * exist to log schema drift and to convert "this doc is garbage" into a
 * render-time throw that per-message ErrorBoundaries can catch and
 * replace with <MalformedMessageFallback />.
 *
 * Design:
 *   - Every validator logs ONE structured warning per bad doc (with id
 *     + offending field) so operators can trace drift back to a backend
 *     release.
 *   - On fatal drift (required-field missing / wrong type) the validator
 *     throws MappingError — the existing ErrorBoundary scope is per-row,
 *     so the thread keeps rendering.
 *   - Non-fatal drift (optional field wrong type) is logged and
 *     silently coerced to a safe default so the row still shows.
 */

export class MappingError extends Error {
  readonly field: string;
  readonly doc: unknown;
  constructor(source: string, field: string, doc: unknown, reason?: string) {
    super(
      `[${source}] malformed payload — field '${field}' invalid${reason ? `: ${reason}` : ''}`,
    );
    this.name = 'MappingError';
    this.field = field;
    this.doc = doc;
  }
}

function fail(source: string, field: string, doc: unknown, reason?: string): never {
  // Log once with the whole doc so drift is debuggable without re-triggering
  // the failure. The ErrorBoundary catches the throw from the caller.
  console.warn(`[${source}] malformed doc — ${field}${reason ? ` (${reason})` : ''}`, doc);
  throw new MappingError(source, field, doc, reason);
}

function warnCoerce(source: string, field: string, value: unknown, fallback: unknown): void {
  console.warn(`[${source}] optional field '${field}' had unexpected type, coerced to fallback:`, {
    value,
    fallback,
  });
}

// ─── Firestore message ──────────────────────────────────────────────

export interface ValidatedFirestoreMessage {
  message_id: string;
  text: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  timestamp: number;
  status?: string;
  attachments?: { url: string; type: string; path: string }[];
  message_type?: string;
}

export function validateFirestoreMessage(raw: unknown): ValidatedFirestoreMessage {
  if (!raw || typeof raw !== 'object') {
    fail('firestore-msg', '(root)', raw, 'not an object');
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.message_id !== 'string' || r.message_id.length === 0) {
    fail('firestore-msg', 'message_id', raw);
  }
  if (typeof r.timestamp !== 'number' || !Number.isFinite(r.timestamp)) {
    fail('firestore-msg', 'timestamp', raw, 'must be finite number');
  }

  // Text is required-ish but many guest channels omit it for
  // media-only messages; coerce to empty string and log if wrong type.
  let text = '';
  if (typeof r.text === 'string') text = r.text;
  else if (r.text !== undefined && r.text !== null) warnCoerce('firestore-msg', 'text', r.text, '');

  const sender_id = typeof r.sender_id === 'string' ? r.sender_id : '';
  const sender_name = typeof r.sender_name === 'string' ? r.sender_name : '';
  const sender_role = typeof r.sender_role === 'string' ? r.sender_role : '';
  if (!sender_id && !sender_role) {
    // Neither field present — we have no way to decide bot/guest/agent.
    // Log and keep rendering with empty strings; the mapper defaults to 'agent'.
    warnCoerce('firestore-msg', 'sender_*', raw, 'both sender_id and sender_role empty');
  }

  const attachments = Array.isArray(r.attachments)
    ? r.attachments.filter((a): a is { url: string; type: string; path: string } =>
        !!a && typeof a === 'object' && typeof (a as { url?: unknown }).url === 'string',
      )
    : undefined;

  return {
    message_id: r.message_id as string,
    text,
    sender_id,
    sender_name,
    sender_role,
    timestamp: r.timestamp as number,
    status: typeof r.status === 'string' ? r.status : undefined,
    attachments,
    message_type: typeof r.message_type === 'string' ? r.message_type : undefined,
  };
}

// ─── Channel-proxy message ──────────────────────────────────────────

export interface ValidatedProxyMessage {
  id: string;
  conversation_id: string;
  company_id: string;
  channel: string;
  direction: 'inbound' | 'outbound';
  sender_id: string;
  sender_name: string | null;
  content_type: string;
  text_body: string | null;
  html_body?: string | null;
  subject: string | null;
  attachments: unknown[];
  metadata: Record<string, unknown>;
  channel_message_id: string | null;
  status: string;
  channel_timestamp: string;
  received_at: string;
}

export function validateProxyMessage(raw: unknown): ValidatedProxyMessage {
  if (!raw || typeof raw !== 'object') {
    fail('proxy-msg', '(root)', raw, 'not an object');
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.id !== 'string') fail('proxy-msg', 'id', raw);
  if (typeof r.conversation_id !== 'string') fail('proxy-msg', 'conversation_id', raw);
  if (typeof r.company_id !== 'string') fail('proxy-msg', 'company_id', raw);
  if (typeof r.channel_timestamp !== 'string') fail('proxy-msg', 'channel_timestamp', raw);
  if (r.direction !== 'inbound' && r.direction !== 'outbound') {
    fail('proxy-msg', 'direction', raw, `got ${String(r.direction)}`);
  }

  return {
    id: r.id as string,
    conversation_id: r.conversation_id as string,
    company_id: r.company_id as string,
    channel: typeof r.channel === 'string' ? r.channel : '',
    direction: r.direction as 'inbound' | 'outbound',
    sender_id: typeof r.sender_id === 'string' ? r.sender_id : '',
    sender_name: typeof r.sender_name === 'string' ? r.sender_name : null,
    content_type: typeof r.content_type === 'string' ? r.content_type : 'text',
    text_body: typeof r.text_body === 'string' ? r.text_body : null,
    html_body: typeof r.html_body === 'string' ? r.html_body : null,
    subject: typeof r.subject === 'string' ? r.subject : null,
    attachments: Array.isArray(r.attachments) ? r.attachments : [],
    metadata:
      r.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : {},
    channel_message_id: typeof r.channel_message_id === 'string' ? r.channel_message_id : null,
    status: typeof r.status === 'string' ? r.status : '',
    channel_timestamp: r.channel_timestamp as string,
    received_at: typeof r.received_at === 'string' ? r.received_at : (r.channel_timestamp as string),
  };
}

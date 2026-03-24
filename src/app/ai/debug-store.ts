/**
 * AI Debug Store — Captures every LLM request/response for the debug panel.
 * Uses a simple in-memory array with event-based subscribers.
 */

export interface AIDebugEntry {
  id: string;
  timestamp: number;
  /** Which feature triggered this call */
  touchpoint: 'compose-reply' | 'ask-ai' | 'classify-inquiry' | 'kb-document-import';
  /** The model used */
  model: string;
  /** System prompt sent */
  systemPrompt: string;
  /** User prompt sent */
  userPrompt: string;
  /** File/document content sent as attachment (for imports) */
  attachment?: string | null;
  /** Raw response text (or error message) */
  response: string | null;
  /** Duration in ms */
  durationMs: number | null;
  /** Token usage if returned by API */
  tokensUsed: { prompt: number; completion: number; total: number } | null;
  /** Error flag */
  error: boolean;
  /** HTTP status */
  status: number | null;
}

type Listener = () => void;

let _entries: AIDebugEntry[] = [];
let _snapshot: AIDebugEntry[] = [];
const _listeners = new Set<Listener>();

/** Get all debug entries (newest first). */
export function getDebugEntries(): AIDebugEntry[] {
  return _snapshot;
}

/** Add a new debug entry (call complete — response already known). */
export function addDebugEntry(entry: AIDebugEntry): void {
  _entries.push(entry);
  // Cap at 50 entries
  if (_entries.length > 50) _entries = _entries.slice(-50);
  _snapshot = [..._entries].reverse();
  _listeners.forEach(fn => fn());
}

/**
 * Register a call that is in-flight (response = null, durationMs = null).
 * The panel will show it as loading immediately.
 */
export function startDebugEntry(entry: AIDebugEntry): void {
  _entries.push(entry);
  if (_entries.length > 50) _entries = _entries.slice(-50);
  _snapshot = [..._entries].reverse();
  _listeners.forEach(fn => fn());
}

/**
 * Fill in the result of an in-flight entry once the call completes.
 */
export function updateDebugEntry(id: string, updates: Partial<AIDebugEntry>): void {
  const idx = _entries.findIndex(e => e.id === id);
  if (idx === -1) return;
  _entries[idx] = { ..._entries[idx], ...updates };
  _snapshot = [..._entries].reverse();
  _listeners.forEach(fn => fn());
}

/** Clear all entries. */
export function clearDebugEntries(): void {
  _entries = [];
  _snapshot = [];
  _listeners.forEach(fn => fn());
}

/** Subscribe to changes (returns unsubscribe fn). */
export function subscribeDebug(fn: Listener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
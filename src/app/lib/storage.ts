import * as idb from 'idb-keyval';

/**
 * IndexedDB-backed key/value storage for app data that outgrew localStorage's
 * ~5 MB ceiling (KB chunks, ingested document blobs, onboarding form data).
 *
 * Migration-safe: reads fall through to localStorage on first access so we
 * don't lose existing user data when swapping the storage layer. Writes go
 * only to IndexedDB; the localStorage mirror is left as-is for rollback
 * safety, and will be cleaned up in a later migration pass.
 */

const store = idb.createStore('ai-bpo-kb', 'kv');

// Typed keys — anything we read/write here must be declared so key sprawl
// doesn't accumulate silently. Add a key, add a typed helper below.
export const STORAGE_KEYS = {
  KB_CHUNKS: 'kb_chunks',
  INGESTED_DOCS: 'ingested_docs',
  ONBOARDING_DATA: 'onboarding_data',
  FORM_TEMPLATE: 'form_template',
  FORM_PHASES: 'form_phases',
  // Legacy localStorage keys we migrate from on first read. These are NOT
  // written to IndexedDB under these names — they're source keys for the
  // one-time migration only.
  LEGACY_KB_ENTRIES_ALL: 'kb_entries_all',
} as const;

export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];

export async function kvGet<T>(key: StorageKey): Promise<T | undefined> {
  const v = await idb.get<T>(key, store);
  if (v !== undefined) return v;
  // Fall-through: first read after migration — lift from localStorage if present.
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as T;
    // Promote to IndexedDB so subsequent reads don't hit localStorage again.
    await idb.set(key, parsed, store);
    return parsed;
  } catch {
    return undefined;
  }
}

export async function kvSet<T>(key: StorageKey, value: T): Promise<void> {
  await idb.set(key, value, store);
}

export async function kvDelete(key: StorageKey): Promise<void> {
  await idb.del(key, store);
}

export async function kvClearAll(): Promise<void> {
  await idb.clear(store);
}

/**
 * Deterministic, stable hash for chunk dedup (chunkHash, contentHash).
 * Uses SubtleCrypto when available (secure contexts), falls back to a fast
 * non-crypto hash for localhost dev. We don't need cryptographic strength —
 * only collision-resistance within a single user's KB, which FNV-1a gives
 * at the scale we care about (thousands of chunks per property).
 */
export async function stableHash(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const buf = new TextEncoder().encode(input);
      const digest = await crypto.subtle.digest('SHA-256', buf);
      const bytes = new Uint8Array(digest);
      let hex = '';
      for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
      return hex.slice(0, 16);
    } catch {
      // fall through
    }
  }
  // FNV-1a 32-bit fallback — fast, good enough for dedup at this scale.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

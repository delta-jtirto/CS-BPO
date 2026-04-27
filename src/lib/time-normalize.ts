/**
 * Single source of truth for converting heterogeneous timestamp inputs to
 * milliseconds since epoch.
 *
 * Why: Firestore (Unified Inbox) stores epoch seconds in some payloads and ms
 * in others; Supabase (channel proxy) returns ISO 8601 strings. Mixing units
 * in `Array.sort` corrupts conversation ordering. Centralize the heuristic
 * here so every consumer agrees.
 *
 * Heuristic: any number > 1e12 (Sep 2001) is already in ms; anything smaller
 * is treated as seconds. Strings are parsed via `Date.parse`. Returns 0 for
 * unparseable input — callers should treat 0 as "no timestamp".
 */
export function toMillis(input: number | string | null | undefined): number {
  if (input == null) return 0;
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) return 0;
    return input > 1e12 ? input : input * 1000;
  }
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : 0;
}

import { useEffect, useState } from 'react';
import { Cloud, CloudOff, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import {
  subscribeKBSyncStatus,
  flushKBSyncQueue,
  type KBSyncStatus,
} from '@/lib/kb-persistence';

/**
 * Tiny header chip showing live Supabase sync status for the knowledge
 * store (chunks + ingested docs). Four visual states:
 *
 *   ● synced     — queue empty, everything landed     (default hidden)
 *   ◐ syncing    — N writes in flight                 (spinner + count)
 *   ☁ offline    — queue has pending, navigator offline (amber, clickable)
 *   ⚠ error      — last attempt failed, backoff pending (amber, clickable)
 *
 * Clicking the chip when pending calls `flushKBSyncQueue()` for an
 * immediate retry. When there are 0 pending writes the chip shows a
 * brief "saved just now" confirmation then fades out.
 */
export function KBSyncIndicator() {
  const [status, setStatus] = useState<KBSyncStatus>(() => ({
    state: 'synced',
    pending: 0,
  }));
  const [showSavedPulse, setShowSavedPulse] = useState(false);

  useEffect(() => {
    let prev = status;
    const unsub = subscribeKBSyncStatus(next => {
      // If we just transitioned to zero-pending from a non-zero state,
      // flash a "saved" pulse for ~1.5s so the user sees confirmation.
      if (prev.pending > 0 && next.pending === 0) {
        setShowSavedPulse(true);
        window.setTimeout(() => setShowSavedPulse(false), 1500);
      }
      prev = next;
      setStatus(next);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hide entirely when nothing to show.
  if (status.state === 'synced' && !showSavedPulse) return null;

  if (showSavedPulse) {
    return (
      <span className="text-[10px] font-medium flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 transition-opacity">
        <CheckCircle2 size={10} />
        <span className="hidden sm:inline">Saved</span>
      </span>
    );
  }

  const isOffline = status.state === 'offline';
  const hasRecentError = status.lastError && status.lastErrorAt &&
    Date.now() - status.lastErrorAt < 30_000;

  const tone = isOffline
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : hasRecentError
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-indigo-50 text-indigo-700 border-indigo-200';

  const Icon = isOffline ? CloudOff : hasRecentError ? AlertCircle : Loader2;
  const spinning = !isOffline && !hasRecentError;

  const title = isOffline
    ? `Offline — ${status.pending} ${status.pending === 1 ? 'change' : 'changes'} will sync when you reconnect`
    : hasRecentError
      ? `Retrying ${status.pending} ${status.pending === 1 ? 'change' : 'changes'} — ${status.lastError}`
      : `Saving ${status.pending} ${status.pending === 1 ? 'change' : 'changes'}…`;

  return (
    <button
      type="button"
      onClick={() => flushKBSyncQueue()}
      title={title}
      className={`text-[10px] font-medium flex items-center gap-1 px-2 py-1 rounded-full border transition-colors hover:opacity-90 ${tone}`}
    >
      <Icon size={10} className={spinning ? 'animate-spin' : ''} />
      <span className="hidden sm:inline">
        {isOffline ? 'Offline' : hasRecentError ? 'Retry' : 'Saving'}
      </span>
      <span className="tabular-nums">{status.pending}</span>
    </button>
  );
}

// Avoid the top-level Cloud unused-import warning if we later drop it.
void Cloud;

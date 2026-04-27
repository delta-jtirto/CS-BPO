/**
 * Auto-reply slice — owns the runtime control surface that gates AI auto-
 * replies per ticket: processing flags, cancellation refs, abort controllers,
 * paused tickets, handed-off tickets, and per-thread AI locks.
 *
 * Cross-slice surface:
 *   - Inbound: `syncPrefToBackend` (so toggles persist to Supabase KV) and
 *     `tickets` (so `resumeAllAI` can iterate the live ticket list).
 *   - Outbound: public fields exactly match the AppState shape (no rename).
 *     Internal `_` setters are exposed so the composer can still drive the
 *     state from elsewhere — the AI kill-switch, the prefs hydrate, the
 *     resolveTicket cleanup, and resetToDemo all need to write into this
 *     slice's state without going through the public callbacks.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ticket } from '../../data/types';

export interface AutoReplySliceParams {
  syncPrefToBackend: (key: string, value: unknown) => void;
  tickets: Ticket[];
}

export interface AutoReplySlicePublic {
  autoReplyProcessing: Record<string, boolean>;
  setAutoReplyProcessing: (ticketId: string, processing: boolean) => void;
  autoReplyCancelledRef: React.MutableRefObject<Record<string, boolean>>;
  autoReplyAbortControllers: React.MutableRefObject<Record<string, AbortController>>;
  cancelAutoReply: (ticketId: string) => void;
  /** Set of ticket IDs that just received their first Firestore message sync. */
  firestoreSyncedTickets: React.MutableRefObject<Set<string>>;
  autoReplyPausedTickets: Record<string, boolean>;
  toggleAutoReplyPause: (ticketId: string) => void;
  setTicketAiEnabled: (ticketId: string, enabled: boolean) => void;
  autoReplyHandedOff: Record<string, boolean>;
  setAutoReplyHandedOff: (ticketId: string, handedOff: boolean) => void;
  resumeAllAI: () => void;
  threadAiLocks: Record<string, boolean>;
  toggleThreadAiLock: (ticketId: string) => void;
}

export interface AutoReplySliceInternal {
  /** Direct state setters — composer uses these for kill-switch / hydrate /
   *  resetToDemo / resolveTicket-cleanup paths that bypass the callbacks. */
  _setAutoReplyProcessingState: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  _setAutoReplyPausedTickets: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  _setAutoReplyHandedOffState: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  _setThreadAiLocks: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

export type AutoReplySliceReturn = AutoReplySlicePublic & AutoReplySliceInternal;

export function useAutoReplySlice({
  syncPrefToBackend,
  tickets,
}: AutoReplySliceParams): AutoReplySliceReturn {
  const [autoReplyProcessing, setAutoReplyProcessingState] = useState<Record<string, boolean>>({});
  const autoReplyCancelledRef = useRef<Record<string, boolean>>({});
  const autoReplyAbortControllers = useRef<Record<string, AbortController>>({});
  const firestoreSyncedTickets = useRef<Set<string>>(new Set());

  const [autoReplyPausedTickets, setAutoReplyPausedTickets] = useState<Record<string, boolean>>(() => {
    try { const s = localStorage.getItem('autoReplyPausedTickets'); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const [autoReplyHandedOff, setAutoReplyHandedOffState] = useState<Record<string, boolean>>(() => {
    try { const s = localStorage.getItem('autoReplyHandedOff'); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const [threadAiLocks, setThreadAiLocks] = useState<Record<string, boolean>>(() => {
    try { const s = localStorage.getItem('threadAiLocks'); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });

  const setAutoReplyProcessing = useCallback((ticketId: string, processing: boolean) => {
    setAutoReplyProcessingState(prev => ({ ...prev, [ticketId]: processing }));
  }, []);

  const cancelAutoReply = useCallback((ticketId: string) => {
    autoReplyCancelledRef.current[ticketId] = true;
    setAutoReplyProcessingState(prev => ({ ...prev, [ticketId]: false }));
    const abortController = autoReplyAbortControllers.current[ticketId];
    if (abortController) {
      abortController.abort();
      delete autoReplyAbortControllers.current[ticketId];
    }
  }, []);

  const toggleAutoReplyPause = useCallback((ticketId: string) => {
    setAutoReplyPausedTickets(prev => {
      const next = { ...prev, [ticketId]: !prev[ticketId] };
      syncPrefToBackend('autoReplyPausedTickets', next);
      return next;
    });
  }, [syncPrefToBackend]);

  const setTicketAiEnabled = useCallback((ticketId: string, enabled: boolean) => {
    setAutoReplyPausedTickets(prev => {
      const next = { ...prev, [ticketId]: !enabled };
      syncPrefToBackend('autoReplyPausedTickets', next);
      return next;
    });
  }, [syncPrefToBackend]);

  const setAutoReplyHandedOff = useCallback((ticketId: string, handedOff: boolean) => {
    setAutoReplyHandedOffState(prev => ({ ...prev, [ticketId]: handedOff }));
  }, []);

  const toggleThreadAiLock = useCallback((ticketId: string) => {
    setThreadAiLocks(prev => {
      const next = { ...prev };
      if (next[ticketId]) {
        delete next[ticketId];
      } else {
        next[ticketId] = true;
      }
      syncPrefToBackend('threadAiLocks', next);
      return next;
    });
  }, [syncPrefToBackend]);

  // Persist paused / handed-off / lock state to localStorage.
  useEffect(() => {
    try { localStorage.setItem('autoReplyPausedTickets', JSON.stringify(autoReplyPausedTickets)); } catch {}
  }, [autoReplyPausedTickets]);

  useEffect(() => {
    try { localStorage.setItem('autoReplyHandedOff', JSON.stringify(autoReplyHandedOff)); } catch {}
  }, [autoReplyHandedOff]);

  useEffect(() => {
    try { localStorage.setItem('threadAiLocks', JSON.stringify(threadAiLocks)); } catch {}
  }, [threadAiLocks]);

  const resumeAllAI = useCallback(() => {
    // Preserve locked threads; clear unlocked thread overrides.
    setAutoReplyPausedTickets(prev => {
      const next: Record<string, boolean> = {};
      for (const [id, val] of Object.entries(prev)) {
        if (threadAiLocks[id]) next[id] = val;
      }
      syncPrefToBackend('autoReplyPausedTickets', next);
      return next;
    });
    // Explicitly set each unlocked ticket to `false` so the `=== false`
    // override check in InboxView/useAutoReply prevents system-message-
    // derived "handed off" status from re-asserting.
    setAutoReplyHandedOffState(prev => {
      const next = { ...prev };
      for (const t of tickets) {
        if (!threadAiLocks[t.id]) next[t.id] = false;
      }
      return next;
    });
  }, [tickets, threadAiLocks, syncPrefToBackend]);

  return {
    autoReplyProcessing,
    setAutoReplyProcessing,
    autoReplyCancelledRef,
    autoReplyAbortControllers,
    cancelAutoReply,
    firestoreSyncedTickets,
    autoReplyPausedTickets,
    toggleAutoReplyPause,
    setTicketAiEnabled,
    autoReplyHandedOff,
    setAutoReplyHandedOff,
    resumeAllAI,
    threadAiLocks,
    toggleThreadAiLock,
    _setAutoReplyProcessingState: setAutoReplyProcessingState,
    _setAutoReplyPausedTickets: setAutoReplyPausedTickets,
    _setAutoReplyHandedOffState: setAutoReplyHandedOffState,
    _setThreadAiLocks: setThreadAiLocks,
  };
}

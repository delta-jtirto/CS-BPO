import { useEffect, useState, useRef, useCallback } from 'react';
import {
  collection, query, orderBy, onSnapshot, limitToLast, endBefore, getDocs,
  type Firestore, type Unsubscribe,
} from 'firebase/firestore';
import type { Message } from '@/app/data/types';
import { mapFirestoreMessage, type FirestoreMessage } from '@/lib/firestore-mappers';

/** Live window size. Threads with more messages are lazy-loaded via loadMore(). */
const LIVE_WINDOW = 100;
/** Page size for historical loadMore() calls. */
const HISTORY_PAGE = 100;

/** LRU-style message cache — keeps last N threads' messages in memory */
const messageCache = new Map<string, Message[]>();
const CACHE_SIZE = 5;

function cacheSet(threadId: string, messages: Message[]) {
  // Evict oldest if at capacity
  if (messageCache.size >= CACHE_SIZE && !messageCache.has(threadId)) {
    const oldest = messageCache.keys().next().value;
    if (oldest) messageCache.delete(oldest);
  }
  messageCache.set(threadId, messages);
}

/** Warm subscriptions — keep alive for 10s after unmount */
const warmSubs = new Map<string, { unsub: Unsubscribe; timer: ReturnType<typeof setTimeout> }>();

function clearWarmSub(threadId: string) {
  const entry = warmSubs.get(threadId);
  if (entry) {
    clearTimeout(entry.timer);
    entry.unsub();
    warmSubs.delete(threadId);
  }
}

interface UseFirestoreMessagesResult {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  /** Fetch the next page of older messages. Returns the number of rows
   *  prepended; 0 means we've reached the start of history. Caller is
   *  responsible for preserving scroll position after the prepend. */
  loadMore: () => Promise<number>;
  /** Signals whether earlier history is available to load. False when the
   *  last loadMore() returned < HISTORY_PAGE, or when the live window
   *  already covers the full thread. */
  hasMore: boolean;
}

/**
 * Real-time subscription to a Firestore thread's messages.
 *
 * Features:
 * - 5-thread LRU cache (back-and-forth is instant)
 * - 150ms spinner delay (fast loads don't flash)
 * - 10s warm unsubscribe (covers quick navigation)
 */
export function useFirestoreMessages(
  threadId: string | null,
  db: Firestore | null,
  guestUserId?: string,
  onAuthError?: () => void,
): UseFirestoreMessagesResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spinnerTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [showSpinner, setShowSpinner] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  /** Oldest message currently rendered — drives loadMore's endBefore cursor. */
  const oldestLoadedRef = useRef<Message | null>(null);

  // Stable ref so callback identity changes don't re-subscribe
  const onAuthErrorRef = useRef(onAuthError);
  onAuthErrorRef.current = onAuthError;

  // Ref to the currently-viewed threadId. Warm subscriptions capture their
  // own threadId in the closure — they check against this ref before calling
  // the shared setMessages, so a warm sub for thread B can't stomp the UI
  // state while the user is viewing thread A.
  const currentThreadIdRef = useRef<string | null>(threadId);
  currentThreadIdRef.current = threadId;

  useEffect(() => {
    if (!threadId || !db) {
      setMessages([]);
      setIsLoading(false);
      setShowSpinner(false);
      setHasMore(true);
      oldestLoadedRef.current = null;
      return;
    }

    // Capture the threadId this effect was set up for. Every setMessages call
    // below checks that we're still viewing this thread before applying.
    const capturedThreadId = threadId;
    const isCurrent = () => currentThreadIdRef.current === capturedThreadId;

    // Check cache first — instant display
    const cached = messageCache.get(capturedThreadId);
    if (cached) {
      setMessages(cached);
      setIsLoading(false);
      setShowSpinner(false);
    } else {
      // Clear old thread's data so we don't flash B's messages inside A's UI
      // while the snapshot for A is still in flight.
      setMessages([]);
      setIsLoading(true);
      setShowSpinner(false);
      // Only show spinner after 150ms delay
      spinnerTimerRef.current = setTimeout(() => setShowSpinner(true), 150);
    }

    // If there's a warm subscription for this thread, reclaim it
    const warm = warmSubs.get(capturedThreadId);
    if (warm) {
      clearTimeout(warm.timer);
      warmSubs.delete(capturedThreadId);
      // The warm subscription is still firing into the cache — we just need to
      // re-establish the state setter. Let it fall through to create a new one
      // (the old one will be cleaned up by Firestore deduplication).
      warm.unsub();
    }

    const messagesRef = collection(db, 'threads', capturedThreadId, 'messages');
    // Live window capped at LIVE_WINDOW most-recent messages. Earlier
    // history is available via loadMore() which prepends with endBefore().
    // Unbounded onSnapshot on 1000+ message threads was the main render
    // bottleneck — O(n) re-sort per tick in the mapper pipeline and a
    // Realtime channel that ships every historical doc on reconnect.
    const q = query(messagesRef, orderBy('timestamp'), limitToLast(LIVE_WINDOW));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const fetched = snapshot.docs.map((doc) => {
          const data = { message_id: doc.id, ...doc.data() } as FirestoreMessage;
          return mapFirestoreMessage(data, guestUserId, capturedThreadId);
        });

        // Cache always — even for warm subs whose thread isn't visible now.
        cacheSet(capturedThreadId, fetched);

        // UI state only when this callback belongs to the visible thread.
        // Without this guard, a warm subscription for a previously-viewed
        // thread would stomp the current thread's rendered messages.
        if (!isCurrent()) return;

        // If the live window is saturated we can assume there's more
        // history; when it arrives partial the thread is fully loaded.
        setHasMore(fetched.length >= LIVE_WINDOW);
        oldestLoadedRef.current = fetched[0] ?? null;

        setMessages(fetched);
        setIsLoading(false);
        setShowSpinner(false);
        if (spinnerTimerRef.current) clearTimeout(spinnerTimerRef.current);
      },
      (err) => {
        console.error(`[Firestore] Messages error for thread ${capturedThreadId}:`, err);
        const code = (err as { code?: string } | null)?.code;
        if (code === 'permission-denied' || code === 'unauthenticated') {
          onAuthErrorRef.current?.();
        }
        if (!isCurrent()) return;
        setError('Failed to load messages');
        setIsLoading(false);
        setShowSpinner(false);
        if (spinnerTimerRef.current) clearTimeout(spinnerTimerRef.current);
      },
    );

    return () => {
      if (spinnerTimerRef.current) clearTimeout(spinnerTimerRef.current);

      // Keep subscription warm for 10s instead of immediate unsubscribe
      const timer = setTimeout(() => {
        unsub();
        warmSubs.delete(capturedThreadId);
      }, 10_000);

      warmSubs.set(capturedThreadId, { unsub, timer });
    };
  }, [threadId, db]);

  /** Prepend the next page of older messages. */
  const loadMore = useCallback(async (): Promise<number> => {
    if (!threadId || !db) return 0;
    const oldest = oldestLoadedRef.current;
    if (!oldest || oldest.createdAt === undefined) return 0;

    try {
      const messagesRef = collection(db, 'threads', threadId, 'messages');
      // Firestore stores timestamps in seconds for some providers — mirror
      // the normalization the mapper does. endBefore expects the RAW
      // field value, so pass the DB-format number (div 1000 if we upconverted).
      const oldestRaw = oldest.createdAt > 1e12 ? oldest.createdAt : Math.floor(oldest.createdAt / 1000);
      const q = query(
        messagesRef,
        orderBy('timestamp'),
        endBefore(oldestRaw),
        limitToLast(HISTORY_PAGE),
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        setHasMore(false);
        return 0;
      }
      const older = snap.docs.map((doc) => {
        const data = { message_id: doc.id, ...doc.data() } as FirestoreMessage;
        return mapFirestoreMessage(data, guestUserId, threadId);
      });
      setMessages((prev) => {
        // Dedup by message id — defensive against overlap at the boundary.
        const existingIds = new Set(prev.map((m) => m.id));
        const filtered = older.filter((m) => !existingIds.has(m.id));
        return [...filtered, ...prev];
      });
      oldestLoadedRef.current = older[0] ?? oldestLoadedRef.current;
      if (older.length < HISTORY_PAGE) setHasMore(false);
      return older.length;
    } catch (err) {
      console.warn('[Firestore] loadMore failed:', err);
      return 0;
    }
  }, [threadId, db, guestUserId]);

  return {
    messages,
    isLoading: isLoading && showSpinner, // Only report loading after 150ms delay
    error,
    loadMore,
    hasMore,
  };
}

/**
 * Prefetch messages for a thread (e.g. highest-urgency adjacent ticket).
 * Subscribes once, populates cache, then unsubscribes.
 */
export function prefetchMessages(threadId: string, db: Firestore, guestUserId?: string): void {
  // Already cached — skip
  if (messageCache.has(threadId)) return;
  // Already warm — skip
  if (warmSubs.has(threadId)) return;

  const messagesRef = collection(db, 'threads', threadId, 'messages');
  const q = query(messagesRef, orderBy('timestamp'));

  const unsub = onSnapshot(q, (snapshot) => {
    const fetched = snapshot.docs.map((doc) => {
      const data = { message_id: doc.id, ...doc.data() } as FirestoreMessage;
      return mapFirestoreMessage(data, guestUserId, threadId);
    });
    cacheSet(threadId, fetched);
    // Unsubscribe after first snapshot — prefetch is one-shot
    unsub();
  });
}

/** Clear the message cache (for testing or reset) */
export function clearMessageCache() {
  messageCache.clear();
  for (const [, entry] of warmSubs) {
    clearTimeout(entry.timer);
    entry.unsub();
  }
  warmSubs.clear();
}

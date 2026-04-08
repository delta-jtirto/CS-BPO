import { useEffect, useState, useRef, useCallback } from 'react';
import {
  collection, query, orderBy, onSnapshot,
  type Firestore, type Unsubscribe,
} from 'firebase/firestore';
import type { Message } from '@/app/data/types';
import { mapFirestoreMessage, type FirestoreMessage } from '@/lib/firestore-mappers';

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
): UseFirestoreMessagesResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spinnerTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [showSpinner, setShowSpinner] = useState(false);

  useEffect(() => {
    if (!threadId || !db) {
      setMessages([]);
      setIsLoading(false);
      setShowSpinner(false);
      return;
    }

    // Check cache first — instant display
    const cached = messageCache.get(threadId);
    if (cached) {
      setMessages(cached);
      setIsLoading(false);
      setShowSpinner(false);
    } else {
      setIsLoading(true);
      setShowSpinner(false);
      // Only show spinner after 150ms delay
      spinnerTimerRef.current = setTimeout(() => setShowSpinner(true), 150);
    }

    // If there's a warm subscription for this thread, reclaim it
    const warm = warmSubs.get(threadId);
    if (warm) {
      clearTimeout(warm.timer);
      warmSubs.delete(threadId);
      // The warm subscription is still firing into the cache — we just need to
      // re-establish the state setter. Let it fall through to create a new one
      // (the old one will be cleaned up by Firestore deduplication).
      warm.unsub();
    }

    const messagesRef = collection(db, 'threads', threadId, 'messages');
    const q = query(messagesRef, orderBy('timestamp'));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const fetched = snapshot.docs.map((doc) => {
          const data = { message_id: doc.id, ...doc.data() } as FirestoreMessage;
          return mapFirestoreMessage(data, guestUserId);
        });

        setMessages(fetched);
        cacheSet(threadId, fetched);
        setIsLoading(false);
        setShowSpinner(false);
        if (spinnerTimerRef.current) clearTimeout(spinnerTimerRef.current);
      },
      (err) => {
        console.error(`[Firestore] Messages error for thread ${threadId}:`, err);
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
        warmSubs.delete(threadId);
      }, 10_000);

      warmSubs.set(threadId, { unsub, timer });
    };
  }, [threadId, db]);

  return {
    messages,
    isLoading: isLoading && showSpinner, // Only report loading after 150ms delay
    error,
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
      return mapFirestoreMessage(data, guestUserId);
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

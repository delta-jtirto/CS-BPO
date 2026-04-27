/**
 * AI BPO Integration: Supabase Realtime hook for proxy channel conversations.
 *
 * Drop this into the AI BPO project at:
 *   src/hooks/use-proxy-conversations.ts
 *
 * Prerequisites:
 *   - @supabase/supabase-js installed in AI BPO
 *   - Supabase client initialized with user's auth session
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

/**
 * Proxy channel Realtime health.
 *   'connected'      — subscribed, receiving updates.
 *   'connecting'     — subscription negotiated, awaiting SUBSCRIBED state.
 *   'polling-only'   — Realtime errored/closed; polling fallback is the
 *                      sole delivery mechanism. Not a failure per se —
 *                      polling still delivers new messages — but surfaces
 *                      the degradation to the composer for Send gating.
 */
export type ProxyRealtimeHealth = 'connected' | 'connecting' | 'polling-only';

/** Module-level, hostId-less — proxy is one Supabase client for all
 *  companies. InboxView / composer gate reads the latest value. */
let _proxyRealtimeHealth: ProxyRealtimeHealth = 'connecting';
const _healthSubscribers = new Set<(h: ProxyRealtimeHealth) => void>();

function setProxyRealtimeHealth(h: ProxyRealtimeHealth) {
  if (_proxyRealtimeHealth === h) return;
  _proxyRealtimeHealth = h;
  for (const cb of _healthSubscribers) cb(h);
}

export function getProxyRealtimeHealth(): ProxyRealtimeHealth {
  return _proxyRealtimeHealth;
}

export function subscribeProxyRealtimeHealth(
  cb: (h: ProxyRealtimeHealth) => void,
): () => void {
  _healthSubscribers.add(cb);
  cb(_proxyRealtimeHealth);
  return () => { _healthSubscribers.delete(cb); };
}

/** React hook wrapper. Reads the module-level state via a small
 *  subscription so components re-render on health changes. */
export function useProxyRealtimeHealth(): ProxyRealtimeHealth {
  const [h, setH] = useState<ProxyRealtimeHealth>(_proxyRealtimeHealth);
  useEffect(() => subscribeProxyRealtimeHealth(setH), []);
  return h;
}

export interface ProxyConversation {
  id: string;
  company_id: string;
  channel: string; // 'whatsapp' | 'instagram' | 'line' | 'email'
  channel_thread_id: string | null;
  subject: string | null;
  status: string;
  last_message_at: string;
  last_message_preview: string | null;
  unread_count: number;
  message_count: number;
  created_at: string;
  updated_at: string;
  contacts: {
    id: string;
    channel_contact_id: string;
    display_name: string | null;
    avatar_url: string | null;
  };
}

export interface ProxyMessage {
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
  attachments: { type: string; url: string; mime_type?: string; filename?: string }[];
  metadata: Record<string, unknown>;
  channel_message_id: string | null;
  status: string;
  /** Populated by the channel proxy when status === 'failed'. Surfaced in
   *  Message.deliveryError so the UI can show the provider's error text
   *  on the failed bubble. */
  error_message?: string | null;
  channel_timestamp: string;
  received_at: string;
}

interface UseProxyConversationsOptions {
  supabase: SupabaseClient;
  companyIds: string[]; // All connected company IDs
  pageSize?: number;
}

export function useProxyConversations({
  supabase,
  companyIds,
  pageSize = 20,
}: UseProxyConversationsOptions) {
  const [conversations, setConversations] = useState<ProxyConversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Initial fetch + polling fallback. Realtime postgres_changes is unreliable
  // in some environments (channels stuck in `joining`/`errored`), so we also
  // poll every 6s and refetch on tab focus so the ticket list — and the
  // conversation previews that feed `ticket.summary` — stay fresh regardless.
  useEffect(() => {
    if (companyIds.length === 0) {
      setConversations([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const fetchConversations = async (markLoading: boolean) => {
      if (markLoading) setIsLoading(true);
      const { data, error } = await supabase
        .from('conversations')
        .select(`
          id, company_id, channel, channel_thread_id, subject, status,
          last_message_at, last_message_preview, unread_count, message_count,
          created_at, updated_at,
          contacts!inner (id, channel_contact_id, display_name, avatar_url)
        `)
        .in('company_id', companyIds)
        .eq('status', 'active')
        .order('last_message_at', { ascending: false })
        .limit(pageSize);
      if (cancelled) return;
      if (error) {
        console.error('Failed to fetch proxy conversations:', error);
      } else {
        const rows = (data ?? []) as unknown as ProxyConversation[];
        setConversations((prev) => {
          // Skip state update if the list is unchanged (same length + same
          // last_message_at on each row). Stops re-renders on steady-state polls.
          if (prev.length === rows.length) {
            const allSame = prev.every(
              (p, i) =>
                p.id === rows[i]?.id &&
                p.last_message_at === rows[i]?.last_message_at &&
                p.last_message_preview === rows[i]?.last_message_preview &&
                p.unread_count === rows[i]?.unread_count,
            );
            if (allSame) return prev;
          }
          return rows;
        });
      }
      if (markLoading) setIsLoading(false);
    };

    fetchConversations(true);

    // Visibility-gated polling: while the tab is hidden we drop the 6s
    // poll entirely (Realtime still pushes updates if it's healthy). When
    // the tab becomes visible again we fetch immediately and restart the
    // interval, so the list is always fresh the instant the agent returns.
    let interval: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (interval) return;
      interval = setInterval(() => fetchConversations(false), 6000);
    };
    const stopPolling = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    };
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      startPolling();
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchConversations(false);
        startPolling();
      } else {
        stopPolling();
      }
    };
    const onFocus = () => fetchConversations(false);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      stopPolling();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [supabase, companyIds.join(','), pageSize]);

  // Realtime subscription for new/updated conversations + module-level
  // health tracking so the composer can gate Send when Realtime is down
  // (polling still delivers but the feedback loop becomes slower).
  useEffect(() => {
    if (companyIds.length === 0) return;

    setProxyRealtimeHealth('connecting');

    const channel = supabase
      .channel('proxy-conversations')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
        },
        (payload) => {
          const row = payload.new as ProxyConversation;
          if (!companyIds.includes(row.company_id)) return;

          if (payload.eventType === 'INSERT') {
            setConversations((prev) => [row, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setConversations((prev) =>
              prev
                .map((c) => (c.id === row.id ? { ...c, ...row } : c))
                .sort(
                  (a, b) =>
                    new Date(b.last_message_at).getTime() -
                    new Date(a.last_message_at).getTime(),
                ),
            );
          }
        },
      )
      .subscribe((status) => {
        // Supabase Realtime status callback fires with one of:
        //   'SUBSCRIBED'      — connected, ready to receive.
        //   'CLOSED'          — channel closed.
        //   'CHANNEL_ERROR'   — server-side error.
        //   'TIMED_OUT'       — handshake / heartbeat timeout.
        if (status === 'SUBSCRIBED') setProxyRealtimeHealth('connected');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setProxyRealtimeHealth('polling-only');
        }
      });

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      setProxyRealtimeHealth('connecting');
    };
  }, [supabase, companyIds.join(',')]);

  const loadMore = useCallback(async () => {
    if (conversations.length === 0) return;

    const lastTimestamp = conversations.at(-1)?.last_message_at;
    if (!lastTimestamp) return;

    const { data } = await supabase
      .from('conversations')
      .select(`
        id, company_id, channel, channel_thread_id, subject, status,
        last_message_at, last_message_preview, unread_count, message_count,
        created_at, updated_at,
        contacts!inner (id, channel_contact_id, display_name, avatar_url)
      `)
      .in('company_id', companyIds)
      .eq('status', 'active')
      .lt('last_message_at', lastTimestamp)
      .order('last_message_at', { ascending: false })
      .limit(pageSize);

    if (data?.length) {
      setConversations((prev) => [
        ...prev,
        ...(data as unknown as ProxyConversation[]),
      ]);
    }
  }, [supabase, companyIds, conversations, pageSize]);

  return { conversations, isLoading, loadMore };
}

// ─── Proxy message cache + warm subscriptions ───────────────────────────────
// Parity with useFirestoreMessages: LRU cache + 10s warm unsubscribe so rapid
// thread switching doesn't tear down and recreate the Realtime channel and
// poll loop. Module-level so all useProxyMessages instances share state.

const PROXY_CACHE_SIZE = 5;
const PROXY_WARM_MS = 10_000;
const proxyMessageCache = new Map<string, ProxyMessage[]>();

function proxyCacheSet(conversationId: string, rows: ProxyMessage[]) {
  if (proxyMessageCache.size >= PROXY_CACHE_SIZE && !proxyMessageCache.has(conversationId)) {
    const oldest = proxyMessageCache.keys().next().value;
    if (oldest) proxyMessageCache.delete(oldest);
  }
  proxyMessageCache.set(conversationId, rows);
}

interface WarmProxySub {
  teardown: () => void;
  timer: ReturnType<typeof setTimeout>;
}
const proxyWarmSubs = new Map<string, WarmProxySub>();

function reclaimProxyWarmSub(conversationId: string): boolean {
  const warm = proxyWarmSubs.get(conversationId);
  if (!warm) return false;
  clearTimeout(warm.timer);
  proxyWarmSubs.delete(conversationId);
  warm.teardown();
  return true;
}

/**
 * Hook for messages within a specific proxy conversation.
 *
 * Subscribes to Supabase Realtime for live updates AND polls on a short
 * interval as a belt-and-suspenders fallback. Supabase Realtime postgres_changes
 * can silently error (channel stuck in `joining`/`errored` state) in certain
 * environments — polling ensures new inbound messages still land in the UI.
 *
 * Polling also re-runs when the window regains focus so agents coming back
 * to a tab see fresh content immediately.
 *
 * Switching conversations keeps the previous conversation's subscription alive
 * for 10s and caches its last message list, so rapid back-and-forth navigation
 * is instant and doesn't churn Realtime channels.
 */
const PROXY_MESSAGE_PAGE = 100;

export function useProxyMessages(
  supabase: SupabaseClient,
  conversationId: string | null,
) {
  const [messages, setMessages] = useState<ProxyMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Current visible conversationId. Warm poll loops and Realtime subscriptions
  // capture their own conversationId at setup time and only update UI state
  // when this ref still matches — so messages from a previously-viewed
  // conversation can't stomp the current view.
  const currentConvIdRef = useRef<string | null>(conversationId);
  currentConvIdRef.current = conversationId;

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }

    const capturedConvId = conversationId;
    const isCurrent = () => currentConvIdRef.current === capturedConvId;

    // Warm-start: if we have a cached list, render instantly; skip loading flag
    const cached = proxyMessageCache.get(capturedConvId);
    if (cached) {
      setMessages(cached);
      setIsLoading(false);
    } else {
      // Clear old conversation's data so we don't flash it inside the new one
      setMessages([]);
      setIsLoading(true);
    }

    // If this conversation is still warming down from a recent unmount, tear
    // down that old subscription so we don't end up with two live channels.
    reclaimProxyWarmSub(capturedConvId);

    let cancelled = false;

    const fetchMessages = async (markLoading: boolean) => {
      if (markLoading && !cached && isCurrent()) setIsLoading(true);
      // Fetch the LATEST N messages: descending + take(N) + reverse in app.
      // Keeps the live window bounded so a 5k-message thread doesn't do a
      // full-history fetch on every poll tick.
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', capturedConvId)
        .order('channel_timestamp', { ascending: false })
        .limit(PROXY_MESSAGE_PAGE);
      if (cancelled) return;
      if (error) {
        console.error('Failed to fetch proxy messages:', error);
      } else {
        // Server returned newest-first; reverse so the UI gets oldest-first.
        const rows = ((data ?? []) as ProxyMessage[]).slice().reverse();
        setHasMore(rows.length >= PROXY_MESSAGE_PAGE);
        // Always update cache so warm reclaim is accurate
        proxyCacheSet(capturedConvId, rows);
        // UI only if still viewing this conversation
        if (!isCurrent()) return;
        setMessages((prev) => {
          // Avoid re-rendering if the row set is unchanged (same count and
          // last row id). Keeps the component stable between polls.
          if (prev.length === rows.length) {
            const lastPrev = prev[prev.length - 1];
            const lastNew = rows[rows.length - 1];
            if (lastPrev?.id === lastNew?.id) return prev;
          }
          return rows;
        });
      }
      if (markLoading && isCurrent()) setIsLoading(false);
    };

    // Initial fetch
    fetchMessages(true);

    // Polling fallback — every 4 seconds, gated on tab visibility. While
    // the tab is hidden we stop polling (Realtime still pushes if healthy);
    // on revisibility we fetch once and restart the interval.
    let interval: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (interval) return;
      interval = setInterval(() => fetchMessages(false), 4000);
    };
    const stopPolling = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    };
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      startPolling();
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchMessages(false);
        startPolling();
      } else {
        stopPolling();
      }
    };
    const onFocus = () => fetchMessages(false);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Best-effort Realtime subscription. If the server accepts it we get
    // instant updates; if it silently errors, the polling loop above covers us.
    const channel = supabase
      .channel(`proxy-messages-${capturedConvId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${capturedConvId}`,
        },
        (payload) => {
          const msg = payload.new as ProxyMessage;
          // Keep cache in sync so warm reclaim stays accurate — always.
          const cachedNow = proxyMessageCache.get(capturedConvId) ?? [];
          if (!cachedNow.some((m) => m.id === msg.id)) {
            proxyCacheSet(capturedConvId, [...cachedNow, msg]);
          }
          // UI only if this callback's conversation is still current.
          if (!isCurrent()) return;
          setMessages((prev) =>
            prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
          );
        },
      )
      .subscribe();

    const teardown = () => {
      cancelled = true;
      stopPolling();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      channel.unsubscribe();
    };

    return () => {
      // Defer teardown by 10s — parity with useFirestoreMessages warm window.
      // If the user navigates back to this conversation, reclaimProxyWarmSub
      // above will cancel the timer and tear down cleanly.
      const timer = setTimeout(() => {
        proxyWarmSubs.delete(capturedConvId);
        teardown();
      }, PROXY_WARM_MS);
      proxyWarmSubs.set(capturedConvId, { teardown, timer });
    };
  }, [supabase, conversationId]);

  /** Prepend the next page of older messages. Returns rows added. */
  const loadMore = useCallback(async (): Promise<number> => {
    if (!conversationId || messages.length === 0) return 0;
    const oldest = messages[0];
    if (!oldest) return 0;
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .lt('channel_timestamp', oldest.channel_timestamp)
      .order('channel_timestamp', { ascending: false })
      .limit(PROXY_MESSAGE_PAGE);
    if (error) {
      console.warn('[useProxyMessages] loadMore failed:', error.message);
      return 0;
    }
    const older = ((data ?? []) as ProxyMessage[]).slice().reverse();
    if (older.length === 0) {
      setHasMore(false);
      return 0;
    }
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      return [...older.filter((m) => !ids.has(m.id)), ...prev];
    });
    if (older.length < PROXY_MESSAGE_PAGE) setHasMore(false);
    return older.length;
  }, [supabase, conversationId, messages]);

  return { messages, isLoading, loadMore, hasMore };
}

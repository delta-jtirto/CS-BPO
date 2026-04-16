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
    const interval = setInterval(() => fetchConversations(false), 6000);
    const onFocus = () => fetchConversations(false);
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [supabase, companyIds.join(','), pageSize]);

  // Realtime subscription for new/updated conversations
  useEffect(() => {
    if (companyIds.length === 0) return;

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
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
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
 */
export function useProxyMessages(
  supabase: SupabaseClient,
  conversationId: string | null,
) {
  const [messages, setMessages] = useState<ProxyMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const fetchMessages = async (markLoading: boolean) => {
      if (markLoading) setIsLoading(true);
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('channel_timestamp', { ascending: true })
        .limit(100);
      if (cancelled) return;
      if (error) {
        console.error('Failed to fetch proxy messages:', error);
      } else {
        const rows = (data ?? []) as ProxyMessage[];
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
      if (markLoading) setIsLoading(false);
    };

    // Initial fetch
    fetchMessages(true);

    // Polling fallback — every 4 seconds
    const interval = setInterval(() => {
      fetchMessages(false);
    }, 4000);

    // Refetch on tab focus for faster recovery when the user switches back
    const onFocus = () => fetchMessages(false);
    window.addEventListener('focus', onFocus);

    // Best-effort Realtime subscription. If the server accepts it we get
    // instant updates; if it silently errors, the polling loop above covers us.
    const channel = supabase
      .channel(`proxy-messages-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const msg = payload.new as ProxyMessage;
          setMessages((prev) =>
            prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
          );
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      channel.unsubscribe();
    };
  }, [supabase, conversationId]);

  return { messages, isLoading };
}

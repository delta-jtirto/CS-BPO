/**
 * AI BPO Integration: Send messages through the channel proxy.
 *
 * Drop this alongside the existing unibox-send.ts in the AI BPO project at:
 *   src/lib/proxy-send.ts
 *
 * For new channels (WhatsApp, Instagram, LINE, Email), use this.
 * For legacy channels (Airbnb, Booking.com), continue using unibox-send.ts.
 */

const PROXY_API_BASE = import.meta.env.VITE_CHANNEL_PROXY_URL || '';

const NEW_CHANNELS = new Set(['whatsapp', 'instagram', 'line', 'email']);

/**
 * Check if a channel should use the proxy (new channels) or unibox (legacy).
 */
export function isProxyChannel(channel: string): boolean {
  return NEW_CHANNELS.has(channel.toLowerCase());
}

/**
 * Send a message to a contact via the channel proxy.
 *
 * clientMessageId is the same UUID recorded in the local
 * outbound_send_idempotency table; we forward it as a header (for
 * future backend-side dedup) and on the body metadata so the
 * channel-proxy can persist it once it starts honoring it.
 *
 * @throws Error with user-friendly message on failure
 */
export async function sendProxyMessage(
  conversationId: string,
  text: string,
  accessToken: string,
  options?: {
    contentType?: string;
    attachments?: { type: string; url: string }[];
    metadata?: Record<string, unknown>;
    clientMessageId?: string;
  },
): Promise<void> {
  if (!PROXY_API_BASE) {
    throw new Error('Channel proxy URL not configured');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  if (options?.clientMessageId) {
    headers['Idempotency-Key'] = options.clientMessageId;
  }

  const combinedMetadata = options?.clientMessageId
    ? { ...(options?.metadata ?? {}), client_message_id: options.clientMessageId }
    : options?.metadata;

  const response = await fetch(`${PROXY_API_BASE}/api/proxy/messages/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      conversation_id: conversationId,
      text,
      content_type: options?.contentType ?? 'text',
      attachments: options?.attachments,
      metadata: combinedMetadata,
    }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Token expired — please sign in again');
    }
    if (response.status === 403) {
      throw new Error('Permission denied — you may not have access to this conversation');
    }
    const body = await response.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Failed to send message (${response.status})`,
    );
  }
}

/**
 * Unified send function that routes to either proxy or unibox.
 * Use this as a drop-in replacement for the existing sendGuestMessage.
 */
export async function sendMessage(
  channel: string,
  params: {
    // For proxy channels (WhatsApp, Instagram, LINE, Email)
    conversationId?: string;
    // For legacy channels (Airbnb, Booking.com)
    threadId?: string;
    senderId?: string;
    // Common
    text: string;
    accessToken: string;
  },
): Promise<void> {
  if (isProxyChannel(channel)) {
    if (!params.conversationId) {
      throw new Error('conversationId required for proxy channels');
    }
    return sendProxyMessage(
      params.conversationId,
      params.text,
      params.accessToken,
    );
  }

  // Legacy: import and call existing unibox-send
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { sendGuestMessage } = await import('./unibox-send');
  return sendGuestMessage(
    params.threadId!,
    params.senderId!,
    params.text,
    params.accessToken,
  );
}

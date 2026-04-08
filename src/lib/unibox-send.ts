const UNIBOX_API_BASE = import.meta.env.VITE_UNIBOX_API_BASE_URL || '';

/**
 * Send a message to a guest via the Unified Inbox API.
 *
 * The backend handles:
 * 1. Delivering to the channel (Airbnb/Booking.com API)
 * 2. Writing the message to Firestore threads/{id}/messages
 * 3. AI BPO's onSnapshot picks it up automatically — no manual state update needed
 *
 * @throws Error with user-friendly message on failure
 */
export async function sendGuestMessage(
  threadId: string,
  senderId: string,
  text: string,
  accessToken: string,
): Promise<void> {
  if (!UNIBOX_API_BASE) {
    throw new Error('Unibox API URL not configured');
  }

  const response = await fetch(`${UNIBOX_API_BASE}v1/unibox/message/send`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      thread_id: threadId,
      sender_id: senderId,
      text,
    }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Token expired — reconnect this inbox in Settings to send messages');
    }
    if (response.status === 403) {
      throw new Error('Permission denied — you may not have access to reply on this thread');
    }
    throw new Error(`Failed to send message (${response.status})`);
  }
}

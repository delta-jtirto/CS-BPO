-- Idempotency key for outbound message sends (channel-proxy + unibox).
--
-- Client generates a UUIDv4 `client_message_id` the moment the composer
-- submits. The edge function upserts `(company_id, thread_key, client_message_id)`
-- with ON CONFLICT DO NOTHING before forwarding to the remote channel. If
-- the user double-clicks Send, a Realtime retry fires, or a tab repeats the
-- POST, only the first attempt dispatches.
--
-- remote_message_id is populated once the channel provider acks the send;
-- lets us correlate optimistic UI bubbles with the authoritative row once
-- it round-trips through the proxy's Realtime stream.
--
-- TTL prune: 30 days is plenty; successful sends are already reflected in
-- the message stream. Keep the idempotency row longer than any plausible
-- retry window.

CREATE TABLE public.outbound_send_idempotency (
  company_id        text        NOT NULL,
  thread_key        text        NOT NULL,
  client_message_id uuid        NOT NULL,
  status            text        NOT NULL DEFAULT 'pending',  -- pending | delivered | failed
  remote_message_id text,
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  PRIMARY KEY (company_id, thread_key, client_message_id)
);

CREATE INDEX idx_outbound_send_thread  ON public.outbound_send_idempotency (company_id, thread_key, created_at DESC);
CREATE INDEX idx_outbound_send_created ON public.outbound_send_idempotency (created_at);

ALTER TABLE public.outbound_send_idempotency ENABLE ROW LEVEL SECURITY;

-- Clients READ to reconcile optimistic bubbles with delivery state; writes
-- happen via the edge function's service role.
CREATE POLICY outbound_send_idempotency_select ON public.outbound_send_idempotency
  FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.outbound_send_idempotency;

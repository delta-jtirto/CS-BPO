-- Durable, source-agnostic bot-reply marker.
--
-- The channel-proxy backend strips our metadata.source='bot' hint during send,
-- so we can't rely on the DB's message row to tell us which outbound messages
-- were AI auto-replies. Instead, when the client sends a bot reply, we record a
-- signature here; when a mapped Message is constructed from any source
-- (channel-proxy / Firestore / mock), the mapper consults this registry and
-- re-stamps sender='bot' for matching messages.
--
-- Signature: (thread_key, text_snippet, sent_at_min) — minute-precision is
-- enough to survive clock skew between client send time and the channel
-- timestamp assigned by the remote provider, but tight enough to avoid
-- cross-thread false positives.

CREATE TABLE public.bot_message_signatures (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   text        NOT NULL,
  thread_key   text        NOT NULL,
  text_snippet text        NOT NULL,
  sent_at_min  bigint      NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bot_message_signatures_company ON public.bot_message_signatures (company_id);
CREATE INDEX idx_bot_message_signatures_thread  ON public.bot_message_signatures (thread_key);

ALTER TABLE public.bot_message_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY bot_message_signatures_select ON public.bot_message_signatures
  FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));

CREATE POLICY bot_message_signatures_insert ON public.bot_message_signatures
  FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

CREATE POLICY bot_message_signatures_update ON public.bot_message_signatures
  FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

CREATE POLICY bot_message_signatures_delete ON public.bot_message_signatures
  FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

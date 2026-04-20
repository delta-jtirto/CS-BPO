-- Server-side idempotency gate for AI auto-replies.
--
-- Replaces the fragile client-side "did I already reply?" check that depended
-- on ticket.messages being hydrated. Every client (tab / browser / device)
-- that sees a new guest message is free to POST to the edge function; the
-- unique PK on (company_id, thread_key, guest_msg_id) ensures exactly one
-- INSERT wins. Loser clients subscribe to Realtime changes on this table and
-- render the winner's `reply_text` without running their own LLM call.
--
-- outcome values:
--   pending     — row inserted, LLM call in flight
--   answered    — AI produced a full reply
--   partial     — AI answered what it could, escalated the rest
--   escalate    — AI punted entirely to a human
--   safety      — safety keyword triggered; deferred to agent
--   superseded  — commit-time tail check found a non-guest message landed
--                 while the LLM was thinking; no reply was injected
--   error       — network / provider / parse failure
--
-- TTL prune: rows are only load-bearing while the thread is actively
-- receiving guest messages. A nightly job can DELETE WHERE created_at <
-- now() - interval '30 days'. Enable pg_cron in the target project and
-- schedule from the Supabase dashboard; not included here to keep the
-- migration portable.

CREATE TABLE public.ai_reply_attempts (
  company_id     text        NOT NULL,
  thread_key     text        NOT NULL,
  guest_msg_id   text        NOT NULL,
  prompt_version text        NOT NULL,
  model          text        NOT NULL,
  outcome        text        NOT NULL DEFAULT 'pending',
  reply_text     text,
  risk_score     int,
  trace_id       uuid        NOT NULL DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  PRIMARY KEY (company_id, thread_key, guest_msg_id)
);

CREATE INDEX idx_ai_reply_attempts_thread  ON public.ai_reply_attempts (company_id, thread_key, created_at DESC);
CREATE INDEX idx_ai_reply_attempts_created ON public.ai_reply_attempts (created_at);

ALTER TABLE public.ai_reply_attempts ENABLE ROW LEVEL SECURITY;

-- Writes land via the edge function's service role; clients READ to hydrate
-- loser-tab UI state, but never write directly.
CREATE POLICY ai_reply_attempts_select ON public.ai_reply_attempts
  FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));

-- Realtime: allow this table on the supabase_realtime publication so loser
-- tabs receive INSERT / UPDATE events and can render the winner's reply.
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_reply_attempts;

-- Persistent smart-reply draft cache.
--
-- PK is (company_id, thread_key) — NOT messages_hash. Rationale: if the
-- agent is mid-edit and a new guest message arrives, the content hash
-- changes. A hash-keyed PK would silently lose the agent's in-progress
-- text. Instead we keep one draft per thread; messages_hash is stored as
-- a column, and on load the UI compares stored vs current hash. When
-- they diverge, the UI surfaces a "N new messages since this draft"
-- banner and lets the agent decide: keep editing, regenerate, or
-- discard. Never a silent wipe.
--
-- `source` distinguishes AI-generated drafts (from compose-reply / smart-
-- reply) from agent-typed drafts (composer auto-save). They share a row
-- per thread; whoever wrote most recently wins.
--
-- TTL prune: 7 days. Drafts older than that are almost always stale
-- (thread moved on) and re-generating / re-typing is cheap.

CREATE TABLE public.ai_reply_drafts (
  company_id     text        NOT NULL,
  thread_key     text        NOT NULL,
  messages_hash  text        NOT NULL,
  draft          jsonb       NOT NULL,
  source         text        NOT NULL,   -- 'ai' | 'agent'
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, thread_key)
);

CREATE INDEX idx_ai_reply_drafts_updated ON public.ai_reply_drafts (updated_at DESC);

ALTER TABLE public.ai_reply_drafts ENABLE ROW LEVEL SECURITY;

-- Drafts are read + written by the authenticated agent directly (no edge
-- function in the path) because they're always scoped to the caller's
-- own session.
CREATE POLICY ai_reply_drafts_select ON public.ai_reply_drafts
  FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));

CREATE POLICY ai_reply_drafts_insert ON public.ai_reply_drafts
  FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

CREATE POLICY ai_reply_drafts_update ON public.ai_reply_drafts
  FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

CREATE POLICY ai_reply_drafts_delete ON public.ai_reply_drafts
  FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_reply_drafts;

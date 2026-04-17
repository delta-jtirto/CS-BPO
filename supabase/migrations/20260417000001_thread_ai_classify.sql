-- Persists classify-inquiry results across sessions so we don't re-run the LLM
-- on an unchanged thread. Keyed by (company_id, thread_key) where thread_key is
-- the app-side ticket.id (works for both Firestore threadIds and proxy_<uuid>).
-- Re-classification happens when (last_message_id, message_count, model_version)
-- diverges from what's cached.

CREATE TABLE public.thread_ai_classify (
  company_id       text        NOT NULL,
  thread_key       text        NOT NULL,
  last_message_id  text        NOT NULL,
  message_count    integer     NOT NULL,
  model_version    text        NOT NULL,
  result           jsonb       NOT NULL,
  classified_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, thread_key)
);

CREATE INDEX idx_thread_ai_classify_classified_at
  ON public.thread_ai_classify (classified_at DESC);

ALTER TABLE public.thread_ai_classify ENABLE ROW LEVEL SECURITY;

CREATE POLICY thread_ai_classify_select ON public.thread_ai_classify
  FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));

CREATE POLICY thread_ai_classify_insert ON public.thread_ai_classify
  FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

CREATE POLICY thread_ai_classify_update ON public.thread_ai_classify
  FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

CREATE POLICY thread_ai_classify_delete ON public.thread_ai_classify
  FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

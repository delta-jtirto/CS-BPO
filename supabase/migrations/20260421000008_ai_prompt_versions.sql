-- Central registry of AI prompt versions.
--
-- Every ai_reply_attempts row already records the `prompt_version` string
-- used for that call, but a bare string isn't enough to drive regression
-- analysis. This table maps the version id to the human-readable metadata
-- we actually want to correlate:
--   * operation       — 'auto_reply' | 'compose_reply' | 'polish_draft' | 'classify_inquiry'
--   * system_prompt   — full text of the system prompt at the time of
--                       registration (snapshot for historical diff).
--   * user_prompt     — template for the user prompt.
--   * model           — default model for the version.
--   * temperature     — default temperature.
--   * notes           — free-text rationale for the version bump.
--   * created_at      — registration time.
--   * retired_at      — soft delete; rows aren't deleted so attempts
--                       pointing at old versions stay explicable.
--
-- Client code doesn't write here directly — it's operator/admin tooling
-- territory. The table is publicly readable (scoped nowhere; a prompt
-- template is not a secret) so dashboards / analyses can join freely
-- against ai_reply_attempts.

CREATE TABLE IF NOT EXISTS public.ai_prompt_versions (
  version       text        PRIMARY KEY,
  operation     text        NOT NULL,
  system_prompt text        NOT NULL,
  user_prompt   text        NOT NULL,
  model         text        NOT NULL,
  temperature   real,
  max_tokens    int,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  retired_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ai_prompt_versions_operation
  ON public.ai_prompt_versions (operation, created_at DESC);

ALTER TABLE public.ai_prompt_versions ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can READ prompt versions — needed for the
-- eventual admin UI to list/diff. Writes go through the service role
-- (admin tooling / CI on prompt-file commit).
DROP POLICY IF EXISTS ai_prompt_versions_select ON public.ai_prompt_versions;
CREATE POLICY ai_prompt_versions_select ON public.ai_prompt_versions
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Seed the version that client code currently stamps
-- (src/lib/ai-reply-idempotency.ts PROMPT_VERSION). Keeps every existing
-- attempt row joinable against a real registry entry instead of hanging
-- on a dangling string.
INSERT INTO public.ai_prompt_versions
  (version, operation, system_prompt, user_prompt, model, notes)
VALUES
  (
    'auto-reply@2026-04-21',
    'auto_reply',
    '(seed) See src/app/ai/prompts.ts → auto_reply.system',
    '(seed) See src/app/ai/prompts.ts → auto_reply.user',
    'google/gemini-2.5-flash-lite',
    'Initial registry seed — mirrors PROMPT_VERSION from ai-reply-idempotency.ts.'
  )
ON CONFLICT (version) DO NOTHING;

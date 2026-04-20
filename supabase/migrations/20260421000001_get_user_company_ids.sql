-- Source of truth for company_id scoping used by every RLS policy in this schema.
--
-- Resolution order:
--   1. JWT claim `app_metadata.companies` — array of company_ids set by the auth
--      provider / admin tooling when the user is provisioned. Preferred path
--      once multi-tenant provisioning is wired up.
--   2. `public.user_companies` table — per-user mapping rows. Useful when the
--      auth layer can't be modified or when companies are assigned dynamically.
--   3. Fallback to the prototype's single tenant (`delta-hq`) when neither is
--      populated. Keeps the existing single-customer deployment working
--      unchanged while the multi-tenant path is phased in.
--
-- Used by RLS policies on: bot_message_signatures, thread_ai_classify,
-- ai_reply_attempts, outbound_send_idempotency, ai_reply_drafts.

CREATE TABLE IF NOT EXISTS public.user_companies (
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_user_companies_user ON public.user_companies (user_id);

ALTER TABLE public.user_companies ENABLE ROW LEVEL SECURITY;

-- Users can read their own mappings; writes go through service role only
-- (admin tooling / provisioning jobs).
DROP POLICY IF EXISTS user_companies_select ON public.user_companies;
CREATE POLICY user_companies_select ON public.user_companies
  FOR SELECT
  USING (user_id = auth.uid());

-- Replace any previous definition. SECURITY DEFINER so the function can read
-- auth.jwt() and user_companies regardless of the caller's own row visibility.
CREATE OR REPLACE FUNCTION public.get_user_company_ids()
RETURNS SETOF text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  jwt_companies jsonb;
  has_rows boolean;
BEGIN
  -- 1. Try JWT claim (app_metadata.companies = array of text)
  BEGIN
    jwt_companies := auth.jwt() -> 'app_metadata' -> 'companies';
  EXCEPTION WHEN OTHERS THEN
    jwt_companies := NULL;
  END;

  IF jwt_companies IS NOT NULL AND jsonb_typeof(jwt_companies) = 'array'
     AND jsonb_array_length(jwt_companies) > 0 THEN
    RETURN QUERY
      SELECT value::text
      FROM jsonb_array_elements_text(jwt_companies);
    RETURN;
  END IF;

  -- 2. Try user_companies table
  SELECT EXISTS (
    SELECT 1 FROM public.user_companies WHERE user_id = auth.uid()
  ) INTO has_rows;

  IF has_rows THEN
    RETURN QUERY
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid();
    RETURN;
  END IF;

  -- 3. Fallback for the single-tenant prototype. Once every user has either
  --    a JWT claim or a user_companies row, delete this branch.
  IF auth.uid() IS NOT NULL THEN
    RETURN QUERY SELECT 'delta-hq'::text;
  END IF;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_company_ids() TO authenticated;

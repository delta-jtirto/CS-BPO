-- Follow-up to 20260422000001_email_sync_cron.sql.
--
-- Managed Supabase denies `ALTER DATABASE postgres SET app.*` even to the
-- `postgres` role, so the GUC approach the first migration assumed cannot
-- work. This migration moves configuration to:
--
--   * proxy_url    — new column on email_sync_settings (not secret, fine in table)
--   * proxy_secret — Supabase Vault under name 'channel_proxy_secret'
--
-- Operator sets the secret once via the Supabase Dashboard vault UI or:
--   SELECT vault.create_secret('<secret-value>', 'channel_proxy_secret');
-- If unset, the tick fires with no Authorization header — fine for
-- unauthenticated batch endpoints, otherwise the proxy will 401.

ALTER TABLE public.email_sync_settings
  ADD COLUMN IF NOT EXISTS proxy_url text;

-- Seed the known proxy URL. Idempotent on re-run.
UPDATE public.email_sync_settings
SET proxy_url = 'https://channel-proxy-teal.vercel.app'
WHERE id = 1 AND (proxy_url IS NULL OR proxy_url = '');

-- Rewrite tick function: read URL from settings table, secret from Vault.
CREATE OR REPLACE FUNCTION public.email_sync_tick()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, vault
AS $$
DECLARE
  s          public.email_sync_settings;
  proxy_sec  text;
  endpoint   text;
  headers    jsonb;
BEGIN
  SELECT * INTO s FROM public.email_sync_settings WHERE id = 1;

  IF NOT FOUND OR NOT s.enabled THEN
    RETURN;
  END IF;

  IF s.last_run_at IS NOT NULL
     AND now() - s.last_run_at < make_interval(secs => s.interval_seconds) THEN
    RETURN;  -- Not due yet.
  END IF;

  IF s.proxy_url IS NULL OR s.proxy_url = '' THEN
    UPDATE public.email_sync_settings
    SET last_run_at = now(), last_status = 'skipped:no_proxy_url'
    WHERE id = 1;
    RETURN;
  END IF;

  endpoint := rtrim(s.proxy_url, '/') || '/api/proxy/email/fetch';

  -- Look up secret by name; vault.decrypted_secrets is a view the postgres
  -- role can read on managed Supabase. Missing secret = no auth header.
  BEGIN
    SELECT decrypted_secret INTO proxy_sec
    FROM vault.decrypted_secrets
    WHERE name = 'channel_proxy_secret'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    proxy_sec := NULL;
  END;

  headers := jsonb_build_object('Content-Type', 'application/json');
  IF proxy_sec IS NOT NULL AND proxy_sec <> '' THEN
    headers := headers || jsonb_build_object('Authorization', 'Bearer ' || proxy_sec);
  END IF;

  BEGIN
    PERFORM net.http_post(
      url     := endpoint,
      headers := headers,
      body    := jsonb_build_object('all', true)
    );

    UPDATE public.email_sync_settings
    SET last_run_at = now(),
        last_status = CASE WHEN proxy_sec IS NULL THEN 'dispatched:no_auth'
                           ELSE 'dispatched' END
    WHERE id = 1;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.email_sync_settings
    SET last_run_at = now(), last_status = 'error:' || left(SQLERRM, 120)
    WHERE id = 1;
  END;
END $$;

-- RPC to update the proxy URL from the app (admin-only in practice; the
-- function runs SECURITY DEFINER and we only grant EXECUTE to authenticated).
CREATE OR REPLACE FUNCTION public.set_email_sync_proxy_url(p_url text)
RETURNS public.email_sync_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  row public.email_sync_settings;
BEGIN
  IF p_url IS NULL OR p_url = '' OR p_url !~ '^https?://' THEN
    RAISE EXCEPTION 'proxy_url must be a non-empty http(s) URL';
  END IF;

  UPDATE public.email_sync_settings
  SET proxy_url  = p_url,
      updated_at = now()
  WHERE id = 1
  RETURNING * INTO row;

  RETURN row;
END $$;

GRANT EXECUTE ON FUNCTION public.set_email_sync_proxy_url(text) TO authenticated;

-- Email sync health observability.
--
-- The prior tick wrote last_status text but that only reflects pg_net
-- dispatch, not what the proxy actually did. This migration:
--
--   1. Captures the pg_net request_id on each tick so we can join to
--      net._http_response for the proxy's real reply.
--   2. Exposes a public.email_sync_health() RPC that bundles:
--        - proxy dispatch status (latest HTTP code, response excerpt)
--        - inbound-email flow signal (recent message count + newest)
--      into a single payload the UI can poll.

ALTER TABLE public.email_sync_settings
  ADD COLUMN IF NOT EXISTS last_request_id bigint;

CREATE OR REPLACE FUNCTION public.email_sync_tick()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, vault
AS $$
DECLARE
  s          public.email_sync_settings;
  proxy_sec  text;
  endpoint   text;
  headers    jsonb;
  req_id     bigint;
BEGIN
  SELECT * INTO s FROM public.email_sync_settings WHERE id = 1;

  IF NOT FOUND OR NOT s.enabled THEN
    RETURN;
  END IF;

  IF s.last_run_at IS NOT NULL
     AND now() - s.last_run_at < make_interval(secs => s.interval_seconds) THEN
    RETURN;
  END IF;

  IF s.proxy_url IS NULL OR s.proxy_url = '' THEN
    UPDATE public.email_sync_settings
    SET last_run_at = now(), last_status = 'skipped:no_proxy_url'
    WHERE id = 1;
    RETURN;
  END IF;

  endpoint := rtrim(s.proxy_url, '/') || '/api/proxy/email/fetch';

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
    SELECT net.http_post(
      url     := endpoint,
      headers := headers,
      body    := jsonb_build_object('all', true)
    ) INTO req_id;

    UPDATE public.email_sync_settings
    SET last_run_at     = now(),
        last_request_id = req_id,
        last_status     = CASE WHEN proxy_sec IS NULL THEN 'dispatched:no_auth'
                               ELSE 'dispatched' END
    WHERE id = 1;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.email_sync_settings
    SET last_run_at = now(), last_status = 'error:' || left(SQLERRM, 120)
    WHERE id = 1;
  END;
END $$;

-- ─── Health RPC ───────────────────────────────────────────────
-- Bundles the two things the UI wants to see:
--   * Did the proxy accept our last call? (status code + short body)
--   * Is mail actually flowing? (count of inbound emails in last 10 min)
-- SECURITY DEFINER because authenticated users can't read net.* or
-- query the full messages table freely via PostgREST in all shapes.
CREATE OR REPLACE FUNCTION public.email_sync_health()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, net, extensions
AS $$
DECLARE
  s            public.email_sync_settings;
  r_status     integer;
  r_error      text;
  r_content    text;
  r_created    timestamptz;
  recent_cnt   integer;
  last_email   timestamptz;
BEGIN
  SELECT * INTO s FROM public.email_sync_settings WHERE id = 1;

  -- Latest HTTP response from our last dispatched request. We read into
  -- individual vars (not a record) so that a missing row leaves everything
  -- NULL instead of tripping "record not yet assigned" on jsonb_build_object.
  IF s.last_request_id IS NOT NULL THEN
    SELECT r.status_code, r.error_msg, r.content::text, r.created
      INTO r_status, r_error, r_content, r_created
    FROM net._http_response r
    WHERE r.id = s.last_request_id
    LIMIT 1;
  END IF;

  SELECT count(*), max(received_at)
    INTO recent_cnt, last_email
  FROM public.messages
  WHERE channel   = 'email'
    AND direction = 'inbound'
    AND received_at > now() - interval '10 minutes';

  RETURN jsonb_build_object(
    'enabled',            s.enabled,
    'interval_seconds',   s.interval_seconds,
    'last_run_at',        s.last_run_at,
    'last_status',        s.last_status,
    'proxy_url',          s.proxy_url,
    'http_status',        r_status,
    'http_error',         r_error,
    'http_excerpt',       left(coalesce(r_content, ''), 200),
    'http_at',            r_created,
    'recent_email_count', coalesce(recent_cnt, 0),
    'last_email_at',      last_email
  );
END $$;

GRANT EXECUTE ON FUNCTION public.email_sync_health() TO authenticated;

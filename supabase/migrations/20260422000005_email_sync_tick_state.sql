-- Split tick-churn fields off email_sync_settings.
--
-- Problem: we added email_sync_settings to supabase_realtime so toggling
-- enabled/interval_seconds in Settings flips the InboxView banner live.
-- But the tick function also writes last_run_at + last_status + last_
-- request_id on every fire (~20-60s), publishing a realtime UPDATE event
-- that reaches every subscribed client. Even though subscribers dedupe,
-- any broad realtime listener in the app re-renders on each tick →
-- visible periodic flash.
--
-- Fix: move the tick-written fields to their own singleton table that is
-- NOT in the realtime publication. email_sync_settings now only UPDATEs
-- on real user edits, so realtime stays quiet between toggles.

CREATE TABLE IF NOT EXISTS public.email_sync_tick_state (
  id              smallint    PRIMARY KEY DEFAULT 1,
  last_run_at     timestamptz,
  last_status     text,
  last_request_id bigint,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_sync_tick_state_singleton CHECK (id = 1)
);

-- Seed singleton row + backfill from the old columns so the first tick
-- still honors the throttle correctly on existing deployments.
INSERT INTO public.email_sync_tick_state (id, last_run_at, last_status, last_request_id)
SELECT 1, last_run_at, last_status, last_request_id
FROM public.email_sync_settings
WHERE id = 1
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.email_sync_tick_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_sync_tick_state_read ON public.email_sync_tick_state;
CREATE POLICY email_sync_tick_state_read
  ON public.email_sync_tick_state FOR SELECT
  TO authenticated USING (true);

-- Rewrite tick: read throttle from tick_state, write results to tick_state.
-- email_sync_settings is read-only from here (except when the user edits
-- enabled/interval_seconds via the set_email_sync_settings RPC).
CREATE OR REPLACE FUNCTION public.email_sync_tick()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, vault
AS $$
DECLARE
  s            public.email_sync_settings;
  ts           public.email_sync_tick_state;
  proxy_sec    text;
  endpoint     text;
  headers      jsonb;
  req_id       bigint;
BEGIN
  SELECT * INTO s FROM public.email_sync_settings WHERE id = 1;

  IF NOT FOUND OR NOT s.enabled THEN
    RETURN;
  END IF;

  SELECT * INTO ts FROM public.email_sync_tick_state WHERE id = 1;

  IF ts.last_run_at IS NOT NULL
     AND now() - ts.last_run_at < make_interval(secs => s.interval_seconds) THEN
    RETURN;  -- Not due yet.
  END IF;

  IF s.proxy_url IS NULL OR s.proxy_url = '' THEN
    UPDATE public.email_sync_tick_state
    SET last_run_at = now(), last_status = 'skipped:no_proxy_url', updated_at = now()
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

    UPDATE public.email_sync_tick_state
    SET last_run_at     = now(),
        last_request_id = req_id,
        last_status     = CASE WHEN proxy_sec IS NULL THEN 'dispatched:no_auth'
                               ELSE 'dispatched' END,
        updated_at      = now()
    WHERE id = 1;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.email_sync_tick_state
    SET last_run_at = now(), last_status = 'error:' || left(SQLERRM, 120), updated_at = now()
    WHERE id = 1;
  END;
END $$;

-- Rewrite health RPC: join settings + tick_state.
CREATE OR REPLACE FUNCTION public.email_sync_health()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, net, extensions
AS $$
DECLARE
  s            public.email_sync_settings;
  ts           public.email_sync_tick_state;
  r_status     integer;
  r_error      text;
  r_content    text;
  r_created    timestamptz;
  recent_cnt   integer;
  last_email   timestamptz;
BEGIN
  SELECT * INTO s  FROM public.email_sync_settings  WHERE id = 1;
  SELECT * INTO ts FROM public.email_sync_tick_state WHERE id = 1;

  IF ts.last_request_id IS NOT NULL THEN
    SELECT r.status_code, r.error_msg, r.content::text, r.created
      INTO r_status, r_error, r_content, r_created
    FROM net._http_response r
    WHERE r.id = ts.last_request_id
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
    'last_run_at',        ts.last_run_at,
    'last_status',        ts.last_status,
    'proxy_url',          s.proxy_url,
    'http_status',        r_status,
    'http_error',         r_error,
    'http_excerpt',       left(coalesce(r_content, ''), 200),
    'http_at',            r_created,
    'recent_email_count', coalesce(recent_cnt, 0),
    'last_email_at',      last_email
  );
END $$;

-- Drop the columns that moved. Doing this in the same migration keeps the
-- schema honest — nothing should read these from email_sync_settings any
-- more. The ConnectedChannelsPanel UI is updated in the paired commit to
-- call email_sync_health() for the Last-tick indicator.
ALTER TABLE public.email_sync_settings
  DROP COLUMN IF EXISTS last_run_at,
  DROP COLUMN IF EXISTS last_status,
  DROP COLUMN IF EXISTS last_request_id;

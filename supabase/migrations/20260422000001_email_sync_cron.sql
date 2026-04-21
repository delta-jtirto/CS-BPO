-- Email sync cron — pulls new mail from every connected IMAP mailbox on a
-- tight interval, giving email the same "messages appear without refresh"
-- feel as the webhook-driven channels (WhatsApp/LINE/Instagram).
--
-- Design:
--   * Single pg_cron job fires `email_sync_tick()` every 20s (the floor).
--   * That function reads the `email_sync_settings` singleton and no-ops
--     unless at least `interval_seconds` have elapsed since last run.
--   * When it does fire, it uses pg_net.http_post (fire-and-forget, async)
--     to hit the external channel proxy's batch email-fetch endpoint.
--   * The proxy iterates connected mailboxes server-side so invocation
--     count stays constant as mailboxes grow.
--
-- Configuration is held in GUCs so secrets never live in SQL files.
-- Operator runs once per environment:
--   ALTER DATABASE postgres SET app.channel_proxy_url    = 'https://proxy.example.com';
--   ALTER DATABASE postgres SET app.channel_proxy_secret = '...';
-- If either is unset the tick no-ops silently — safe for fresh checkouts.

-- ─── Settings singleton ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_sync_settings (
  id               smallint     PRIMARY KEY DEFAULT 1,
  enabled          boolean      NOT NULL DEFAULT true,
  interval_seconds integer      NOT NULL DEFAULT 60
                                CHECK (interval_seconds BETWEEN 20 AND 3600),
  last_run_at      timestamptz,
  last_status      text,
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT email_sync_settings_singleton CHECK (id = 1)
);

INSERT INTO public.email_sync_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.email_sync_settings ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read; writes go through the RPC below so we
-- can validate bounds server-side and keep the singleton constraint clean.
DROP POLICY IF EXISTS email_sync_settings_read ON public.email_sync_settings;
CREATE POLICY email_sync_settings_read
  ON public.email_sync_settings FOR SELECT
  TO authenticated USING (true);

-- ─── RPC: update interval / enabled ───────────────────────────
CREATE OR REPLACE FUNCTION public.set_email_sync_settings(
  p_interval_seconds integer,
  p_enabled          boolean DEFAULT NULL
)
RETURNS public.email_sync_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  row public.email_sync_settings;
BEGIN
  IF p_interval_seconds < 20 OR p_interval_seconds > 3600 THEN
    RAISE EXCEPTION 'interval_seconds must be between 20 and 3600';
  END IF;

  UPDATE public.email_sync_settings
  SET interval_seconds = p_interval_seconds,
      enabled          = COALESCE(p_enabled, enabled),
      updated_at       = now()
  WHERE id = 1
  RETURNING * INTO row;

  RETURN row;
END $$;

GRANT EXECUTE ON FUNCTION public.set_email_sync_settings(integer, boolean) TO authenticated;

-- ─── Tick function ────────────────────────────────────────────
-- Runs every 20s via pg_cron. Internally throttles to the configured
-- interval so the ACTUAL fetch cadence matches the user-chosen setting
-- without needing to reschedule pg_cron on each UI change.
CREATE OR REPLACE FUNCTION public.email_sync_tick()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  s          public.email_sync_settings;
  proxy_url  text;
  proxy_sec  text;
  endpoint   text;
BEGIN
  SELECT * INTO s FROM public.email_sync_settings WHERE id = 1;

  IF NOT FOUND OR NOT s.enabled THEN
    RETURN;
  END IF;

  IF s.last_run_at IS NOT NULL
     AND now() - s.last_run_at < make_interval(secs => s.interval_seconds) THEN
    RETURN;  -- Not due yet.
  END IF;

  proxy_url := current_setting('app.channel_proxy_url', true);
  proxy_sec := current_setting('app.channel_proxy_secret', true);

  IF proxy_url IS NULL OR proxy_url = '' THEN
    UPDATE public.email_sync_settings
    SET last_run_at = now(), last_status = 'skipped:no_proxy_url'
    WHERE id = 1;
    RETURN;
  END IF;

  endpoint := rtrim(proxy_url, '/') || '/api/proxy/email/fetch';

  -- Fire-and-forget. pg_net writes the response to net._http_response async.
  -- We intentionally do not await — a slow proxy must not back up the tick.
  BEGIN
    PERFORM net.http_post(
      url     := endpoint,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || COALESCE(proxy_sec, '')
      ),
      body    := jsonb_build_object('all', true)
    );

    UPDATE public.email_sync_settings
    SET last_run_at = now(), last_status = 'dispatched'
    WHERE id = 1;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.email_sync_settings
    SET last_run_at = now(), last_status = 'error:' || left(SQLERRM, 120)
    WHERE id = 1;
  END;
END $$;

-- ─── Schedule ─────────────────────────────────────────────────
-- Sub-minute interval requires pg_cron 1.4+ (Supabase ships 1.6). On older
-- deployments the '20 seconds' string will fail; fall through to NOTICE.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    PERFORM cron.schedule(
      'email-sync-tick',
      '20 seconds',
      $sql$SELECT public.email_sync_tick();$sql$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'email-sync-tick scheduling skipped: %', SQLERRM;
END $$;

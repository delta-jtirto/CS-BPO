-- TTL prune for idempotency + signature tables.
--
-- All four tables accumulate rows faster than they're needed. Left alone
-- they grow unbounded, slow queries, and bloat indexes. This migration
-- schedules nightly DELETEs via pg_cron — but only if the extension is
-- available. On projects without pg_cron we create the prune *functions*
-- anyway so operators can invoke them from a dashboard scheduler or a
-- dedicated worker without copy-pasting SQL.
--
-- Retention rationale:
--   * ai_reply_attempts           — 30d (post-hoc attribution window)
--   * outbound_send_idempotency   — 30d (retry protection is short-lived)
--   * ai_reply_drafts             — 7d  (stale drafts are noise)
--   * bot_message_signatures      — 30d (bot/agent attribution in live UI)

CREATE OR REPLACE FUNCTION public.prune_ai_reply_attempts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.ai_reply_attempts
  WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.prune_outbound_send_idempotency()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.outbound_send_idempotency
  WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.prune_ai_reply_drafts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.ai_reply_drafts
  WHERE updated_at < now() - interval '7 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.prune_bot_message_signatures()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.bot_message_signatures
  WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Schedule nightly runs if pg_cron is available. Wrapped in a DO block
-- so projects without the extension just skip this section. cron.schedule
-- is idempotent on the job name.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'prune-ai-reply-attempts',
      '15 3 * * *',  -- 03:15 UTC nightly
      $sql$SELECT public.prune_ai_reply_attempts();$sql$
    );
    PERFORM cron.schedule(
      'prune-outbound-send-idempotency',
      '20 3 * * *',
      $sql$SELECT public.prune_outbound_send_idempotency();$sql$
    );
    PERFORM cron.schedule(
      'prune-ai-reply-drafts',
      '25 3 * * *',
      $sql$SELECT public.prune_ai_reply_drafts();$sql$
    );
    PERFORM cron.schedule(
      'prune-bot-message-signatures',
      '30 3 * * *',
      $sql$SELECT public.prune_bot_message_signatures();$sql$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- pg_cron present but scheduling failed (permissions, duplicate name
  -- on old Postgres). Swallow — the prune functions still exist and
  -- operators can schedule them manually.
  RAISE NOTICE 'pg_cron scheduling skipped: %', SQLERRM;
END $$;

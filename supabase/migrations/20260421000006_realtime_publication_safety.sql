-- Safety rerun for ALTER PUBLICATION on new tables.
--
-- The earlier migrations (20260421000002..4) ran
--   ALTER PUBLICATION supabase_realtime ADD TABLE <x>
-- unconditionally. On a self-hosted / locally-reset Supabase project
-- where the supabase_realtime publication doesn't exist, those
-- migrations fail. This migration:
--
--   1. Creates the publication if it doesn't exist (no-op on hosted
--      Supabase where it always exists).
--   2. Re-adds each new table idempotently — catching duplicate_object
--      so a rerun on a project that already picked them up is a no-op.
--
-- Put it last in the 20260421 sequence so it corrects any earlier
-- failure without forcing a full schema rebuild.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_reply_attempts;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.outbound_send_idempotency;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_reply_drafts;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END $$;

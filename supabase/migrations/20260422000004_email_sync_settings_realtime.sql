-- Add email_sync_settings to the realtime publication so toggles in
-- Settings → Advanced reflect immediately in the InboxView banner
-- (otherwise users need a full reload to see the hide/show flip).
--
-- REPLICA IDENTITY FULL is required — without it UPDATE events arrive
-- without payload.new populated, and the React subscription can't read
-- the new `enabled` value. The row is tiny (singleton), so the WAL
-- overhead from FULL replica identity is negligible.
ALTER TABLE public.email_sync_settings REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'email_sync_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.email_sync_settings;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'realtime publication add skipped: %', SQLERRM;
END $$;

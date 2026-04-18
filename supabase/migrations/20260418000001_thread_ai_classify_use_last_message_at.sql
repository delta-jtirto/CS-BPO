-- Signature switch: last_message_id was a synthetic per-session mapper
-- counter, not a stable identifier. Rename to last_message_at (epoch ms)
-- so the cache key survives page reloads. Existing rows are wiped — their
-- old ids no longer compare meaningfully.

TRUNCATE TABLE public.thread_ai_classify;

ALTER TABLE public.thread_ai_classify
  DROP COLUMN last_message_id,
  ADD COLUMN last_message_at bigint NOT NULL;

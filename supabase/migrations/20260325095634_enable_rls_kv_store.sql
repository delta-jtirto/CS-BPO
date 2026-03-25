-- Enable Row Level Security on kv_store_ab702ee0
-- All access goes through the Edge Function (SUPABASE_SERVICE_ROLE_KEY),
-- which bypasses RLS. No public policies needed — this blocks all direct
-- PostgREST access from anon/authenticated roles.
ALTER TABLE kv_store_ab702ee0 ENABLE ROW LEVEL SECURITY;

-- Knowledge chunks — the canonical store for every unit of property
-- knowledge the AI consumes. Replaces the IndexedDB-only store with a
-- server-backed table so agents + hosts can share state across devices.
--
-- Scope model:
--   company_id  (RLS key)      — Delta tenant. Scoped via get_user_company_ids().
--   host_id                    — Host-company within the tenant (M-Connect,
--                                Delta Luxe, etc.). Used for intra-tenant
--                                filtering on the client, NOT for RLS.
--   prop_id                    — Specific property, or NULL for host-global
--                                knowledge that applies to every property.
--   room_id                    — Specific room, or NULL for property-wide.
--
-- Why company_id is the RLS key and not host_id:
--   A single Delta user can see every host they're assigned to. Host is a
--   UI filter, not a security boundary. RLS on company_id prevents tenant
--   A from ever reading tenant B's chunks even if host ids collide.
--
-- Callable by:
--   - Client code via supabase-js (reads + writes under the user's JWT).
--   - Edge functions via service_role (bypass RLS) for server-driven AI
--     context building. Both paths see the same table; the `source` /
--     `is_override` fields already carry all provenance the AI needs.

CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  -- Client-generated stable id. Upsert by this key is the only write mode.
  id            text        PRIMARY KEY,

  -- Scope
  company_id    text        NOT NULL,
  host_id       text        NOT NULL,
  prop_id       text,
  room_id       text,

  -- Type + content
  kind          text        NOT NULL,
  title         text        NOT NULL,
  body          text        NOT NULL,
  chunk_hash    text        NOT NULL,
  structured    jsonb,

  -- Slot identity (property_fact only — enum-constrained slotKey)
  slot_key      text,
  is_override   boolean     NOT NULL DEFAULT false,
  supersedes    text,

  -- Provenance
  source        jsonb       NOT NULL,
  -- { type, docId?, docSheet?, docRow?, originalText?, extractedAt?,
  --   editedBy?, editReason? }

  -- Lifecycle
  visibility    text        NOT NULL DEFAULT 'guest_facing',
  status        text        NOT NULL DEFAULT 'active',
  tags          text[],

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Value checks — catch client bugs early rather than letting malformed
  -- rows poison AI context.
  CONSTRAINT knowledge_chunks_kind_valid CHECK (kind IN (
    'property_fact', 'faq', 'reply_template', 'sop', 'urgency_rule', 'workflow'
  )),
  CONSTRAINT knowledge_chunks_visibility_valid CHECK (visibility IN (
    'internal', 'guest_facing'
  )),
  CONSTRAINT knowledge_chunks_status_valid CHECK (status IN (
    'active', 'archived', 'pending_review', 'superseded'
  ))
);

-- Indexes — matched to the three hottest query paths:
--   1. "show me all active chunks for prop X in company Y" (Inspector load)
--   2. "is there an active chunk at slotKey Z?" (re-ingest diff)
--   3. "show me everything needing review" (triage landing)
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_scope
  ON public.knowledge_chunks (company_id, host_id, prop_id, status);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_slot
  ON public.knowledge_chunks (company_id, slot_key)
  WHERE slot_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_pending
  ON public.knowledge_chunks (company_id, status)
  WHERE status = 'pending_review';

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_kind
  ON public.knowledge_chunks (company_id, kind, status);

-- updated_at auto-bump on every UPDATE so realtime subscribers and TTL
-- reasoning see accurate timestamps regardless of client hygiene.
CREATE OR REPLACE FUNCTION public.knowledge_chunks_bump_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_knowledge_chunks_updated_at ON public.knowledge_chunks;
CREATE TRIGGER trg_knowledge_chunks_updated_at
  BEFORE UPDATE ON public.knowledge_chunks
  FOR EACH ROW
  EXECUTE FUNCTION public.knowledge_chunks_bump_updated_at();

ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

-- SELECT: any row in a company the user is a member of.
DROP POLICY IF EXISTS knowledge_chunks_select ON public.knowledge_chunks;
CREATE POLICY knowledge_chunks_select ON public.knowledge_chunks
  FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));

-- INSERT: users can insert rows for their own companies. Prevents a
-- malicious client from seeding rows into other tenants.
DROP POLICY IF EXISTS knowledge_chunks_insert ON public.knowledge_chunks;
CREATE POLICY knowledge_chunks_insert ON public.knowledge_chunks
  FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

-- UPDATE: same scoping. Also blocks moving a chunk across company_ids
-- via UPDATE (the WITH CHECK clause).
DROP POLICY IF EXISTS knowledge_chunks_update ON public.knowledge_chunks;
CREATE POLICY knowledge_chunks_update ON public.knowledge_chunks
  FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

-- DELETE: same scoping. Archived chunks are pruned here; agents can also
-- force-delete via the Inspector's "Delete now" button.
DROP POLICY IF EXISTS knowledge_chunks_delete ON public.knowledge_chunks;
CREATE POLICY knowledge_chunks_delete ON public.knowledge_chunks
  FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

-- Realtime publication — other tabs/devices on the same company see
-- chunk mutations live. Idempotent ADD TABLE: safe to re-run.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.knowledge_chunks;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;


-- ────────────────────────────────────────────────────────────────────────
-- Ingested documents — one row per uploaded file. Enables content-hash
-- dedup (skip AI router when contentHash matches a prior upload) and
-- "Recent imports" listing in the Inspector sidebar.
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ingested_documents (
  id            text        PRIMARY KEY,
  company_id    text        NOT NULL,
  host_id       text        NOT NULL,
  prop_id       text,
  filename      text        NOT NULL,
  content_hash  text        NOT NULL,
  uploaded_by   text        NOT NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  sheets        text[],
  chunk_ids     text[]      NOT NULL DEFAULT '{}',
  status        text        NOT NULL DEFAULT 'ready',
  parse_error   text,

  CONSTRAINT ingested_documents_status_valid CHECK (status IN (
    'processing', 'ready', 'partial', 'failed'
  ))
);

CREATE INDEX IF NOT EXISTS idx_ingested_documents_scope
  ON public.ingested_documents (company_id, prop_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingested_documents_dedup
  ON public.ingested_documents (company_id, filename, content_hash);

ALTER TABLE public.ingested_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ingested_documents_select ON public.ingested_documents;
CREATE POLICY ingested_documents_select ON public.ingested_documents
  FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));

DROP POLICY IF EXISTS ingested_documents_insert ON public.ingested_documents;
CREATE POLICY ingested_documents_insert ON public.ingested_documents
  FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

DROP POLICY IF EXISTS ingested_documents_update ON public.ingested_documents;
CREATE POLICY ingested_documents_update ON public.ingested_documents
  FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

DROP POLICY IF EXISTS ingested_documents_delete ON public.ingested_documents;
CREATE POLICY ingested_documents_delete ON public.ingested_documents
  FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ingested_documents;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;


-- ────────────────────────────────────────────────────────────────────────
-- TTL prune — archived chunks older than 90 days are auto-deleted.
-- Archived is the "soft-delete" state the re-ingest flow uses when a
-- chunk is removed from the latest document upload. Agents get 90 days
-- to notice and Restore; after that the row is reclaimed.
--
-- Cron scheduling is intentionally omitted from the migration (pg_cron
-- availability varies per Supabase plan). Run manually from the dashboard
-- or wire up via Supabase scheduled functions. A single nightly call is
-- sufficient.
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.prune_archived_knowledge_chunks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.knowledge_chunks
  WHERE status = 'archived'
    AND updated_at < now() - interval '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Only the service role can invoke the pruner; no user-facing code path.
REVOKE ALL ON FUNCTION public.prune_archived_knowledge_chunks() FROM public;
REVOKE ALL ON FUNCTION public.prune_archived_knowledge_chunks() FROM authenticated;

-- Allow authenticated clients to write outbound_send_idempotency directly.
--
-- The UNIQUE PK is the security property here: a malicious or buggy client
-- can only ever INSERT one row per (company_id, thread_key, client_message_id),
-- which is already the idempotency guarantee we want. Going through an edge
-- function would just add a network hop without strengthening this.
--
-- UPDATEs are restricted to the two terminal status transitions from
-- 'pending'; clients cannot rewrite completed rows.

CREATE POLICY outbound_send_idempotency_insert ON public.outbound_send_idempotency
  FOR INSERT
  WITH CHECK (
    company_id IN (SELECT get_user_company_ids())
    AND status = 'pending'
  );

CREATE POLICY outbound_send_idempotency_update ON public.outbound_send_idempotency
  FOR UPDATE
  USING (
    company_id IN (SELECT get_user_company_ids())
    AND status = 'pending'
  )
  WITH CHECK (
    company_id IN (SELECT get_user_company_ids())
    AND status IN ('delivered', 'failed')
  );

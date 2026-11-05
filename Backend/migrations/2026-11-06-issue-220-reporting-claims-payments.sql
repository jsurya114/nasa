-- Issue #220 (NASA Insights connector), part 3: read-only reporting views for carrier claims and driver payments.
-- Needs part 2 (reporting schema and role). Additive; nothing existing changes. No password, email, phone, bank or tax detail is exposed.
-- IMPORTANT: if the Everee migrations are run AFTER this one, run this file again afterwards. The payment view is built from the tables that
-- exist at the time; until it is re-run, returned deposits are not visible (the view says so in deposit_info_available, and the
-- payment overview warns).
-- WHO RUNS THIS: the database owner or a superuser, after a BACKUP. Safe to run more than once.

-- One row per CURRENT carrier claim (the latest version of each claim), with the decision made about it.
--  * decision: chargeable (a driver owes it), exempt (owes nothing, including the agreed DFWGOFO + Tracking interruption exemption),
--    or unmatched: 'unresolved', 'ambiguous' or 'review' (no driver yet; never silently assigned or deducted). A claim with no
--    decision record at all is shown as 'unresolved'.
--  * city_id: the city of the decision, or, while unmatched, the city whose upload brought the claim in.
--  * deducted_in_approved_runs: what active claim lines in APPROVED (finalized) pay runs took for any version of the claim, before
--    any later refund. It is not a balance; the Payroll balances remain the authority for what a driver still owes.
CREATE OR REPLACE VIEW reporting.claim_facts AS
SELECT c.id                                              AS claim_id,
       c.courier,
       c.claim_type,
       c.claim_at::date                                  AS claim_date,
       COALESCE(m.city_id, c.import_city_id)             AS city_id,
       COALESCE(m.status, 'unresolved')                  AS decision,
       c.deduction_amount                                AS claim_amount,
       m.eligible_deduction                              AS chargeable_amount,
       COALESCE((SELECT SUM(-l.amount)
                   FROM pay_statement_lines l
                   JOIN courier_claims cv ON cv.id = l.claim_id
                   JOIN pay_statements s  ON s.id = l.statement_id
                   JOIN pay_runs r        ON r.id = s.pay_run_id
                  WHERE cv.claim_key = c.claim_key AND l.active AND l.line_type = 'claim' AND r.status = 'finalized'), 0) AS deducted_in_approved_runs
  FROM courier_claims c
  LEFT JOIN courier_claim_matches m ON m.claim_id = c.id
 WHERE c.superseded_at IS NULL;

-- One row per pay statement of a draft or approved (finalized) pay run. Discarded and voided runs are not payments and are left out.
--  * state: pending (draft run), approved (finalized, not sent yet), submitted, unconfirmed, failed, paid.
--  * deposit_returned: the payment provider reported a paid deposit as returned. A returned deposit is NOT a successful payment.
--  * deposit_info_available: false when the Everee table did not exist when this view was built, so returned deposits cannot be seen.
-- The everee table is read only when it exists (it arrives with the Everee migrations), so this migration runs before or after them.
DO $$
DECLARE
  returned_expr text := 'false';
  returned_join text := '';
  info_expr text := 'false';
BEGIN
  IF to_regclass('public.everee_payment_items') IS NOT NULL THEN
    returned_expr := 'COALESCE(i.deposit_returned, false)';
    returned_join := 'LEFT JOIN everee_payment_items i ON i.pay_statement_id = s.id';
    info_expr := 'true';
  END IF;
  EXECUTE format($view$
    CREATE OR REPLACE VIEW reporting.payment_facts AS
    SELECT s.id                AS statement_id,
           r.id                AS pay_run_id,
           r.status            AS run_status,
           r.city_id,
           c.job               AS city_name,
           r.period_start,
           r.period_end,
           s.driver_id,
           d.name              AS driver_name,
           s.net,
           s.payout_status,
           CASE WHEN r.status = 'draft' THEN 'pending'
                WHEN s.payout_status = 'not_submitted' THEN 'approved'
                ELSE s.payout_status END AS state,
           s.paid_at,
           %s                  AS deposit_returned,
           %s                  AS deposit_info_available
      FROM pay_statements s
      JOIN pay_runs r ON r.id = s.pay_run_id
      JOIN city c     ON c.id = r.city_id
      JOIN drivers d  ON d.id = s.driver_id
      %s
     WHERE r.status IN ('draft', 'finalized')
  $view$, returned_expr, info_expr, returned_join);
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA reporting FROM PUBLIC;
GRANT SELECT ON reporting.claim_facts, reporting.payment_facts TO nasa_reporting_reader;

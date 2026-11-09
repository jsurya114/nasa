-- Insights: claim losses (issue #220/#227 follow-up). Two read-only reporting views, so the "Claim losses" section can say how much of what the carrier
-- charged NASA has not been taken back from drivers. Additive: nothing existing changes and nothing here deducts or pays anything.
--
-- reporting.claim_loss_facts       one row per current carrier claim: the claim facts of reporting.claim_facts plus the matched driver, whether that driver
--                                  is still enabled and the date of their last delivery. The driver's identity is used only to ask "is this driver still
--                                  working?"; reports show amounts, never names.
-- reporting.carrier_statement_items the carrier's claims, ledger adjustments, prepayments and withdrawal fees of each published statement (a statement
--                                  with its billing week and city). Created only when the carrier statement tables exist (issue #252).
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once. Rollback: the .rollback.sql file next to this one.

CREATE OR REPLACE VIEW reporting.claim_loss_facts AS
SELECT cf.claim_id,
       cf.claim_type,
       cf.claim_date,
       cf.city_id,
       cf.decision,
       cf.claim_amount,
       cf.chargeable_amount,
       cf.deducted_in_approved_runs,
       m.driver_id,
       COALESCE(d.enabled, false) AS driver_enabled,
       last_work.last_delivery_date AS driver_last_delivery_date
  FROM reporting.claim_facts cf
  LEFT JOIN courier_claim_matches m ON m.claim_id = cf.claim_id
  LEFT JOIN drivers d ON d.id = m.driver_id
  LEFT JOIN (SELECT f.driver_id, max(f.business_date) AS last_delivery_date
               FROM reporting.delivery_facts f
              WHERE f.delivered > 0
              GROUP BY f.driver_id) last_work ON last_work.driver_id = m.driver_id;

DO $$
BEGIN
  IF to_regclass('public.carrier_statement_items') IS NOT NULL AND to_regclass('public.carrier_statements') IS NOT NULL THEN
    EXECUTE $view$
      CREATE OR REPLACE VIEW reporting.carrier_statement_items AS
      SELECT i.statement_id, s.city_id, s.period_start, s.period_end, i.kind, i.label, (i.amount_cents::numeric / 100) AS amount
        FROM carrier_statement_items i
        JOIN carrier_statements s ON s.id = i.statement_id
       WHERE s.status = 'published'
    $view$;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nasa_reporting_reader') THEN
    GRANT SELECT ON reporting.claim_loss_facts TO nasa_reporting_reader;
    IF to_regclass('reporting.carrier_statement_items') IS NOT NULL THEN
      GRANT SELECT ON reporting.carrier_statement_items TO nasa_reporting_reader;
    END IF;
  END IF;
END $$;

-- Should list the view(s).
SELECT table_name FROM information_schema.views WHERE table_schema = 'reporting' AND table_name IN ('claim_loss_facts', 'carrier_statement_items') ORDER BY table_name;

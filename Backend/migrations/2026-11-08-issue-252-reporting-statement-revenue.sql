-- Issue #252, reporting part: one definition of delivery revenue and margin for every report.
--
-- Weekly GOFO revenue is what the carrier billed (a published carrier statement); driver earnings are NASA's stored gross driver earnings. Daily SpeedX keeps
-- its stored company price fields. A weekly record in a week with no verified statement keeps the old price-based figure but is labelled 'estimated'.
-- Existing columns of reporting.delivery_facts are unchanged; columns are only appended. Needs the carrier statement tables (2026-11-08-issue-252-carrier-statements.sql)
-- and the reporting views (2026-11-06-issue-220-reporting-views.sql). Safe to run twice. Run it as the database owner, after a backup, on a copy first.
-- Rollback: 2026-11-08-issue-252-reporting-statement-revenue.rollback.sql

-- revenue_basis says where a record's revenue comes from:
--   'statement'  weekly record covered by a published carrier statement (its matched fees; 0 when the carrier billed nothing for it)
--   'recorded'   daily record with both stored amounts (revenue = driver earnings + stored company earnings)
--   'estimated'  weekly record with both stored amounts but no verified statement for its week: the old price-based figure, not the carrier's bill
--   NULL         no usable amounts yet (still open); counted in deliveries, never as zero revenue
-- The matched carrier fee is shown on ONE record per Delivery ID, day and route (the lowest id), so a repeated record cannot multiply revenue.
CREATE OR REPLACE VIEW reporting.delivery_facts AS
SELECT pd.id                                       AS fact_id,
       pd.journey_date                             AS business_date,
       pd.driver_id,
       d.name                                      AS driver_name,
       r.id                                        AS route_id,
       c.id                                        AS city_id,
       c.job                                       AS city_name,
       c.city_code,
       c.city_type,
       CASE WHEN pd.start_seq IS NULL OR pd.end_seq IS NULL OR pd.start_seq = 0 OR pd.end_seq = 0
            THEN 'weekly' ELSE 'daily' END         AS source,
       CASE c.city_type
         WHEN 'DAILY'  THEN (pd.start_seq <> 0 AND pd.end_seq <> 0)
         WHEN 'WEEKLY' THEN (pd.start_seq = 0 AND pd.end_seq = 0)
         ELSE true END                             AS counts_for_city,
       COALESCE(pd.delivered, 0)                   AS delivered,
       COALESCE(pd.closed, false)                  AS closed,
       pd.driver_payment                           AS gross_driver_earnings,
       pd.company_earnings                         AS company_margin,
       (pd.driver_payment IS NOT NULL AND pd.company_earnings IS NOT NULL) AS amounts_complete,
       ((pd.driver_payment IS NULL) <> (pd.company_earnings IS NULL))      AS amounts_partial,
       -- appended for issue #252
       CASE WHEN st.statement_id IS NOT NULL THEN (COALESCE(st.fee_cents, 0)::numeric / 100)
            WHEN pd.driver_payment IS NOT NULL AND pd.company_earnings IS NOT NULL THEN pd.driver_payment + pd.company_earnings
       END                                         AS delivery_revenue,
       CASE WHEN st.statement_id IS NOT NULL THEN (CASE WHEN pd.driver_payment IS NOT NULL THEN (COALESCE(st.fee_cents, 0)::numeric / 100) - pd.driver_payment END)
            WHEN pd.driver_payment IS NOT NULL AND pd.company_earnings IS NOT NULL THEN pd.company_earnings
       END                                         AS delivery_margin,
       CASE WHEN st.statement_id IS NOT NULL THEN 'statement'
            WHEN pd.driver_payment IS NOT NULL AND pd.company_earnings IS NOT NULL
                 THEN (CASE WHEN pd.start_seq IS NULL OR pd.end_seq IS NULL OR pd.start_seq = 0 OR pd.end_seq = 0 THEN 'estimated' ELSE 'recorded' END)
       END                                         AS revenue_basis,
       (pd.driver_payment IS NOT NULL AND (st.statement_id IS NOT NULL OR pd.company_earnings IS NOT NULL)) AS revenue_complete,
       st.statement_id                             AS statement_id,
       COALESCE(pd.insurance_deduction, 0)         AS insurance_withheld
  FROM payment_dashboard pd
  JOIN drivers d ON d.id = pd.driver_id
  JOIN routes  r ON r.id = pd.route_id
  JOIN city    c ON c.job = r.job
  LEFT JOIN LATERAL (
    SELECT s.id AS statement_id,
           (SELECT sum(g.fee_cents) FROM carrier_statement_groups g WHERE g.statement_id = s.id AND g.payment_dashboard_id = pd.id) AS fee_cents
      FROM carrier_statements s
     WHERE s.status = 'published' AND s.city_id = c.id
       AND (EXISTS (SELECT 1 FROM carrier_statement_groups g WHERE g.statement_id = s.id AND g.payment_dashboard_id = pd.id)
            OR ((pd.start_seq IS NULL OR pd.end_seq IS NULL OR pd.start_seq = 0 OR pd.end_seq = 0) AND pd.journey_date BETWEEN s.period_start AND s.period_end))
     ORDER BY s.version DESC
     LIMIT 1
  ) st ON true;

-- The carrier's unmatched money, kept as UNALLOCATED revenue of the statement's city on the carrier's signing day. It belongs to no driver, so it has no
-- driver earnings and no delivery count; reports add it to revenue and to margin and show it apart.
CREATE OR REPLACE VIEW reporting.statement_unallocated AS
SELECT s.id AS statement_id, c.id AS city_id, c.job AS city_name, g.signed_on AS business_date,
       (sum(g.fee_cents)::numeric / 100) AS revenue, (count(*))::int AS groups
  FROM carrier_statement_groups g
  JOIN carrier_statements s ON s.id = g.statement_id AND s.status = 'published'
  JOIN city c ON c.id = s.city_id
 WHERE g.match_state <> 'matched'
 GROUP BY s.id, c.id, c.job, g.signed_on;

-- The statements that stand, by billing week: settlement is by billing week, trends are by signing day.
CREATE OR REPLACE VIEW reporting.carrier_statements AS
SELECT s.id AS statement_id, s.city_id, c.job AS city_name, s.period_start, s.period_end, s.billing_week, s.bill_number, s.version, s.origin,
       ((s.detail_fee_cents + s.offset_cents)::numeric / 100) AS delivery_revenue,
       (s.claims_cents::numeric / 100)                        AS claims,
       (s.adjustments_cents::numeric / 100)                   AS adjustments,
       (s.settlement_payable_cents::numeric / 100)            AS settlement_payable,
       (t.matched_cents::numeric / 100)                       AS matched_revenue,
       (t.unallocated_cents::numeric / 100)                   AS unallocated_revenue
  FROM carrier_statements s
  JOIN carrier_statement_totals t ON t.statement_id = s.id
  JOIN city c ON c.id = s.city_id
 WHERE s.status = 'published';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nasa_reporting_reader') THEN
    GRANT SELECT ON reporting.delivery_facts, reporting.statement_unallocated, reporting.carrier_statements TO nasa_reporting_reader;
  END IF;
END $$;

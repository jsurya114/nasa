-- Issue #252, reporting part: one definition of delivery revenue and margin for every report.
--
-- Weekly GOFO revenue is what the carrier billed (a published carrier statement); driver earnings are NASA's stored gross driver earnings. Daily SpeedX keeps
-- its stored company price fields. A weekly record in a week with no verified statement keeps the old price-based figure but is labelled 'estimated'.
-- Existing columns of reporting.delivery_facts are unchanged; columns are only appended. Needs the carrier statement tables (2026-11-08-issue-252-carrier-statements.sql)
-- and the reporting views (2026-11-06-issue-220-reporting-views.sql). Safe to run twice. Run it as the database owner, after a backup, on a copy first.
-- Rollback: 2026-11-08-issue-252-reporting-statement-revenue.rollback.sql

-- revenue_basis says where a record's revenue comes from:
--   'statement'  weekly record covered by a published carrier statement (its matched fees; 0 when the carrier billed nothing for it), or a record with no estimate that
--                only carries cross-week carrier money. A statement REPLACES the estimate only for the week it covers.
--   'recorded'   daily record with both stored amounts (revenue = driver earnings + stored company earnings)
--   'estimated'  weekly record with both stored amounts but no verified statement for its week: the old price-based figure, not the carrier's bill. Cross-week carrier
--                money (an offset from a later statement) is added on top and the label stays 'estimated'.
--   NULL         no usable amounts yet (still open); counted in deliveries, never as zero revenue
-- A carrier group is matched to ONE record (the lowest id of its Delivery ID, day and route), so a repeated record cannot multiply revenue. A record's revenue is its
-- base (the covering statement's fees, or the stored estimate when no statement covers its week) plus the cross-week groups of other statements matched to it.
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
       -- Revenue of a record = its BASE + any CROSS-WEEK carrier money matched to it.
       --   base: the fees of the statement that covers the record's billing week when there is one (zero if the carrier billed nothing for it), otherwise the stored estimate
       --         (driver + company earnings) when both are known. A statement replaces the estimate only for the week it covers.
       --   cross-week money: carrier groups from OTHER published statements matched to this record (a later week can carry an offset for an earlier day). They are added on
       --         top, whether the base is a statement or an estimate, and never replace it.
       CASE WHEN st.cover_id IS NOT NULL THEN ((st.own_cents + st.extra_cents)::numeric / 100)
            WHEN pd.driver_payment IS NOT NULL AND pd.company_earnings IS NOT NULL THEN pd.driver_payment + pd.company_earnings + (st.extra_cents::numeric / 100)
            WHEN st.groups > 0 THEN (st.extra_cents::numeric / 100)
       END                                         AS delivery_revenue,
       CASE WHEN st.cover_id IS NOT NULL THEN (CASE WHEN pd.driver_payment IS NOT NULL THEN ((st.own_cents + st.extra_cents)::numeric / 100) - pd.driver_payment END)
            WHEN pd.driver_payment IS NOT NULL AND pd.company_earnings IS NOT NULL THEN pd.company_earnings + (st.extra_cents::numeric / 100)
       END                                         AS delivery_margin,
       CASE WHEN st.cover_id IS NOT NULL THEN 'statement'
            WHEN pd.driver_payment IS NOT NULL AND pd.company_earnings IS NOT NULL
                 THEN (CASE WHEN pd.start_seq IS NULL OR pd.end_seq IS NULL OR pd.start_seq = 0 OR pd.end_seq = 0 THEN 'estimated' ELSE 'recorded' END)
            WHEN st.groups > 0 THEN 'statement'
       END                                         AS revenue_basis,
       (pd.driver_payment IS NOT NULL AND (st.cover_id IS NOT NULL OR pd.company_earnings IS NOT NULL)) AS revenue_complete,
       st.cover_id                                 AS statement_id,
       COALESCE(pd.insurance_deduction, 0)         AS insurance_withheld
  FROM payment_dashboard pd
  JOIN drivers d ON d.id = pd.driver_id
  JOIN routes  r ON r.id = pd.route_id
  JOIN city    c ON c.job = r.job
  LEFT JOIN LATERAL (
    SELECT cover.statement_id AS cover_id,
           COALESCE(anchored.groups, 0)::int AS groups,
           COALESCE(anchored.own_cents, 0)   AS own_cents,
           COALESCE(anchored.extra_cents, 0) AS extra_cents
      FROM (SELECT 1) one
      LEFT JOIN LATERAL (
        SELECT s.id AS statement_id
          FROM carrier_statements s
         WHERE s.status = 'published' AND s.city_id = c.id
           AND (pd.start_seq IS NULL OR pd.end_seq IS NULL OR pd.start_seq = 0 OR pd.end_seq = 0) AND pd.journey_date BETWEEN s.period_start AND s.period_end
         ORDER BY s.version DESC
         LIMIT 1
      ) cover ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS groups,
               sum(g.fee_cents) FILTER (WHERE g.statement_id IS NOT DISTINCT FROM cover.statement_id) AS own_cents,
               sum(g.fee_cents) FILTER (WHERE g.statement_id IS DISTINCT FROM cover.statement_id)     AS extra_cents
          FROM carrier_statement_groups g
          JOIN carrier_statements gs ON gs.id = g.statement_id AND gs.status = 'published' AND gs.city_id = c.id
         WHERE g.payment_dashboard_id = pd.id
      ) anchored ON true
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

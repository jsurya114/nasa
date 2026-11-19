-- Reporting: insurance withheld is what the pay statement actually charged (pull request "no insurance for a driver paid under 5 dollars").
--
-- A driver whose pay in a pay run is under $5 pays no insurance for that run, but the upload's pay row still carries $1.92 a day. reporting.delivery_facts took the
-- row's amount, so Insights, the carrier statement economics and the loss report showed insurance that was never withheld. The column `insurance_withheld` now
-- follows the frozen pay statement for a row that is on one (none charged = 0) and keeps the stored amount for a row that is not. Nothing else in the view changes:
-- same columns, same names, same types, so everything that reads the view keeps working. Statement lines are history, so a paid statement's figure never moves.
-- Needs 2026-11-08-issue-252-reporting-statement-revenue.sql and the pay run tables (2026-11-03-issue-143-pay-runs.sql). Safe to run twice. Run it as the database
-- owner, after a backup, on a copy first. It can run before or after the code is deployed.
-- Rollback: 2026-11-19-reporting-insurance-from-statement.rollback.sql

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
       -- what the driver was actually charged: the insurance the pay statement froze for the row when it is on a statement, else the stored amount (see
       -- services/payroll/insuranceSql.js, which holds the same expression for the Dashboard and the driver screens)
       COALESCE((CASE
          WHEN EXISTS (SELECT 1 FROM pay_statement_lines ie WHERE ie.payment_dashboard_id = pd.id AND ie.active AND ie.line_type = 'earning')
          THEN COALESCE((SELECT -SUM(il.amount)
                           FROM pay_statement_lines ie JOIN pay_statement_lines il ON il.statement_id = ie.statement_id AND il.payment_dashboard_id = ie.payment_dashboard_id AND il.active AND il.line_type = 'insurance'
                          WHERE ie.payment_dashboard_id = pd.id AND ie.active AND ie.line_type = 'earning'), 0)
          ELSE pd.insurance_deduction
        END), 0)                                   AS insurance_withheld
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

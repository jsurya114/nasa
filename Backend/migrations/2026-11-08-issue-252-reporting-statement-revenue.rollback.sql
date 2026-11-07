-- Rollback for issue #252 (reporting part): puts reporting.delivery_facts back to its issue #220 definition and removes the two new views.
-- Reports that use the new columns stop working until the code is rolled back too.
DROP VIEW IF EXISTS reporting.carrier_statements;
DROP VIEW IF EXISTS reporting.statement_unallocated;
DROP VIEW IF EXISTS reporting.delivery_facts;
CREATE VIEW reporting.delivery_facts AS
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
       ((pd.driver_payment IS NULL) <> (pd.company_earnings IS NULL))      AS amounts_partial
  FROM payment_dashboard pd
  JOIN drivers d ON d.id = pd.driver_id
  JOIN routes  r ON r.id = pd.route_id
  JOIN city    c ON c.job = r.job;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nasa_reporting_reader') THEN
    GRANT SELECT ON reporting.delivery_facts TO nasa_reporting_reader;
  END IF;
END $$;

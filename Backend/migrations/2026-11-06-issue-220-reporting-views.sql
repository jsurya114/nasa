-- Issue #220 (NASA Insights connector), part 2: read-only reporting views and a role that can read only them.
-- The views are the ONLY thing the reporting role can see. They expose business totals and driver display names; they never expose
-- passwords, emails, phone numbers, bank or tax details, access codes or any sign-in record. Nothing existing changes.
--
-- WHO RUNS THIS: the database owner or a superuser (it creates a role and a schema), after a BACKUP. Safe to run more than once.
-- It does NOT create a login or set a password: see docs/INSIGHTS_MCP_SETUP.md ("Reporting database role").

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nasa_reporting_reader') THEN
    CREATE ROLE nasa_reporting_reader NOLOGIN NOINHERIT;   -- a group: a login role is added to it separately
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS reporting;

-- Cities as reports see them.
CREATE OR REPLACE VIEW reporting.cities AS
SELECT c.id AS city_id, c.job AS city_name, c.city_code, c.city_type, COALESCE(c.enabled, true) AS enabled
  FROM city c;

-- One row per stored delivery record of the Dashboard (payment_dashboard), the same source the Dashboard totals read, for both
-- daily and weekly cities. Amounts are the STORED ones: nothing is recalculated from today's route rates.
--  * city_id/city_name: the city of the ROUTE the record was made on, so a driver who moves city never moves old deliveries.
--  * source: 'weekly' when the record has no sequence numbers, else 'daily' (the Dashboard's own rule).
--  * counts_for_city: the Dashboard's rule when a city is selected (a DAILY city counts records with sequence numbers, a WEEKLY
--    city counts records without). Reports apply it everywhere so city totals equal the Dashboard's city totals.
--  * amounts_complete / amounts_partial: a record that is still open has no stored amounts yet (provisional); it is counted and
--    disclosed, never treated as zero revenue.
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
       ((pd.driver_payment IS NULL) <> (pd.company_earnings IS NULL))      AS amounts_partial
  FROM payment_dashboard pd
  JOIN drivers d ON d.id = pd.driver_id
  JOIN routes  r ON r.id = pd.route_id
  JOIN city    c ON c.job = r.job;

-- The role sees the schema and these views, nothing else. (The views run with their owner's rights, so the role needs no access
-- to the tables underneath, and has none.)
REVOKE ALL ON SCHEMA reporting FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA reporting FROM PUBLIC;
GRANT USAGE ON SCHEMA reporting TO nasa_reporting_reader;
GRANT SELECT ON reporting.cities, reporting.delivery_facts TO nasa_reporting_reader;

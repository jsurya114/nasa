-- Rollback for issue #220 part 2: removes the reporting views and the reporting group role. Reporting tools stop working.
-- Drop any login role that was added to the group first (DROP ROLE <login role>), or the last statement will fail.
DROP VIEW IF EXISTS reporting.delivery_facts;
DROP VIEW IF EXISTS reporting.cities;
DROP SCHEMA IF EXISTS reporting;
DROP ROLE IF EXISTS nasa_reporting_reader;

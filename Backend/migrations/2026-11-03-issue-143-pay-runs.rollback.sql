-- Rollback for issue #143 (pay runs): removes the pay run tables, their triggers and the payroll settings.
-- BACK UP FIRST: this deletes every pay run, statement and line, and the settings history.
-- If payouts (#31) already reference statements, roll that back first. Existing pay rows are untouched.
DROP TABLE IF EXISTS pay_statement_lines;
DROP TABLE IF EXISTS pay_statements;
DROP TABLE IF EXISTS pay_runs;
DROP TABLE IF EXISTS payroll_settings_history;
DROP TABLE IF EXISTS payroll_settings;
DROP FUNCTION IF EXISTS pay_statement_lines_guard();
DROP FUNCTION IF EXISTS pay_statements_guard();

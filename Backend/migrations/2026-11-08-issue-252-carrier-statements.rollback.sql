-- Rollback for issue #252 (carrier statements). This deletes every stored carrier statement and its audit trail. Back up first.
-- Nothing in payroll, pay runs or payment_dashboard is touched.
DROP VIEW IF EXISTS carrier_statement_totals;
DROP TABLE IF EXISTS carrier_statement_events;
DROP TABLE IF EXISTS carrier_statement_groups;
DROP TABLE IF EXISTS carrier_statement_items;
DROP TABLE IF EXISTS carrier_statement_lines;
DROP TABLE IF EXISTS carrier_statements;
DROP FUNCTION IF EXISTS carrier_statement_groups_guard();
DROP FUNCTION IF EXISTS carrier_statements_guard();
DROP FUNCTION IF EXISTS carrier_statement_evidence_guard();

-- Rolls back 2026-11-10-reporting-claim-losses.sql: only the two reporting views are dropped. No data changes.
DROP VIEW IF EXISTS reporting.claim_loss_facts;
DROP VIEW IF EXISTS reporting.carrier_statement_items;

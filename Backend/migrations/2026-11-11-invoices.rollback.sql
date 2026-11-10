-- Rolls back 2026-11-11-invoices.sql. THIS DELETES EVERY SAVED INVOICE, LINE AND VENDOR. Back up first; prefer restoring a backup.
DROP VIEW IF EXISTS reporting.invoice_payments;
DROP TABLE IF EXISTS invoice_lines;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS invoice_vendors;
DROP FUNCTION IF EXISTS invoice_lines_guard();
DROP FUNCTION IF EXISTS invoices_guard();

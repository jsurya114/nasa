-- Rolls back 2026-11-10-quickbooks-payments.sql. Drops the QuickBooks payment batches, items, attempts and settings. Back up first, and only
-- when no batch holds a payment that matters: statements already marked paid stay paid, but their QuickBooks references here would be lost.
DROP TABLE IF EXISTS quickbooks_payment_attempts;
DROP TABLE IF EXISTS quickbooks_payment_items;
DROP TABLE IF EXISTS quickbooks_payment_batches;
DROP TABLE IF EXISTS quickbooks_settings;

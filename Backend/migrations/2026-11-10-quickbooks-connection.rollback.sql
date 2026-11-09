-- Rolls back 2026-11-10-quickbooks-connection.sql. Drops the QuickBooks connection, state and vendor links. Back up first.
DROP TABLE IF EXISTS quickbooks_vendors;
DROP TABLE IF EXISTS quickbooks_connect_state;
DROP TABLE IF EXISTS quickbooks_connection;

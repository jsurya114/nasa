-- Rollback for issue #109: remove the two indexes. Data is not touched.
-- Run without a transaction block (DROP INDEX CONCURRENTLY cannot run inside one).
DROP INDEX CONCURRENTLY IF EXISTS idx_deliveries_dashboard_data_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_payment_dashboard_dashboard_data_id;

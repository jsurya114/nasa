-- Issue #109: index the "rows for this journey" lookups.
-- deliveries and payment_dashboard are searched by dashboard_data_id in the journey triggers
-- (sync_deliveries_with_sequence, update_payment_dashboard, delete_dashboard_data_related_rows)
-- and in the foreign-key checks when a journey is deleted. Without an index each lookup reads
-- the whole table (about a million deliveries), which made editing and deleting journeys slow.
--
-- Additive only: no data, column or behaviour changes. Safe to run more than once.
-- CONCURRENTLY builds the index without blocking reads or writes, so the app can stay up.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first.
-- Run each statement on its own, NOT inside a transaction (no BEGIN/COMMIT, no "psql -1"),
-- because CREATE INDEX CONCURRENTLY cannot run in a transaction block. Plain "psql -f" is fine.
-- If a build is interrupted it can leave an INVALID index; the check at the end lists any.
-- Drop such an index with the rollback file and run this file again.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deliveries_dashboard_data_id
  ON deliveries (dashboard_data_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_dashboard_dashboard_data_id
  ON payment_dashboard (dashboard_data_id);

-- Both rows should show valid = t.
SELECT c.relname AS index_name, i.indisvalid AS valid
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
WHERE c.relname IN ('idx_deliveries_dashboard_data_id', 'idx_payment_dashboard_dashboard_data_id');

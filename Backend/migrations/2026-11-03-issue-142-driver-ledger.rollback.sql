-- Rollback for issue #142 (driver ledger): removes the table, its trigger and function.
-- BACK UP FIRST if entries were recorded: this deletes every recorded advance, expense, reimbursement and claim.
-- If the pay-run work (#143) already uses these entries, roll that back first.
DROP TABLE IF EXISTS driver_ledger_entries;
DROP FUNCTION IF EXISTS driver_ledger_entries_no_change();

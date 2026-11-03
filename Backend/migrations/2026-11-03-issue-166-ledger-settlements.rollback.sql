-- Rollback for issue #166 (ledger settlements): removes the table, its trigger and function.
-- BACK UP FIRST if settlements were recorded: this deletes every recorded outside repayment, waiver and reversal,
-- and the entries they settled would owe their full amount again.
DROP TABLE IF EXISTS driver_ledger_settlements;
DROP FUNCTION IF EXISTS driver_ledger_settlements_no_change();

-- Rollback for issue #166 (ledger edit links): removes the table, its trigger and function.
-- BACK UP FIRST if edits were recorded: the voided originals and their replacements stay in the ledger, but the
-- link between them (and the reason for the edit) is lost.
DROP TABLE IF EXISTS driver_ledger_edits;
DROP FUNCTION IF EXISTS driver_ledger_edits_no_change();

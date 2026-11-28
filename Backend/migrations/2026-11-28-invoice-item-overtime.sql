-- Item-based invoices: overtime on a line. Two optional columns after the quantity, OT hours and OT rate, and the line's total becomes
--   rate x quantity + OT hours x OT rate, rounded once to the cent (half up), for example 100 x 2 + 2 x 30 = 260.00.
-- A line without overtime keeps both columns empty (NULL) and its total stays rate x quantity, so every invoice saved before this is unchanged.
-- Hourly lines never use these columns (they keep their own "overtime" hours column).
--
-- Additive: two new nullable columns, and the line-shape check is replaced by one that also allows overtime. No row is changed. The paid-invoice
-- guard is not affected (it fires on row changes, not on ALTER TABLE).
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Run BEFORE deploying the code that saves overtime. Safe to run more than once.
-- Rollback: the .rollback.sql file next to this one (it refuses while any line has overtime).

ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS ot_hours numeric(10,2) CHECK (ot_hours IS NULL OR ot_hours >= 0);
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS ot_rate  numeric(12,2) CHECK (ot_rate IS NULL OR ot_rate >= 0);

ALTER TABLE invoice_lines DROP CONSTRAINT IF EXISTS invoice_lines_shape;
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_shape CHECK (
  (kind = 'hourly' AND job IS NOT NULL AND re_hours IS NOT NULL AND overtime IS NOT NULL AND total_hours IS NOT NULL
    AND line_date IS NULL AND item IS NULL AND rate IS NULL AND quantity IS NULL AND ot_hours IS NULL AND ot_rate IS NULL)
  OR (kind = 'item' AND line_date IS NOT NULL AND item IS NOT NULL AND rate IS NOT NULL AND quantity IS NOT NULL
    AND job IS NULL AND re_hours IS NULL AND overtime IS NULL AND total_hours IS NULL
    AND (ot_hours IS NULL) = (ot_rate IS NULL)
    AND line_total = round(rate * quantity + COALESCE(ot_hours * ot_rate, 0), 2))
);

-- Should list ot_hours and ot_rate.
SELECT column_name FROM information_schema.columns WHERE table_name = 'invoice_lines' AND column_name IN ('ot_hours', 'ot_rate') ORDER BY 1;

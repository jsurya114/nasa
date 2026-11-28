-- Rolls back 2026-11-28-invoice-item-overtime.sql. It refuses while any saved line has overtime: removing the columns would change what those invoices
-- say. Back up first. Lines without overtime are not changed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM invoice_lines WHERE ot_hours IS NOT NULL OR ot_rate IS NOT NULL) THEN
    RAISE EXCEPTION 'invoice_lines has lines with overtime; rolling back would change those invoices. Nothing was changed.';
  END IF;
END $$;

ALTER TABLE invoice_lines DROP CONSTRAINT IF EXISTS invoice_lines_shape;
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_shape CHECK (
  (kind = 'hourly' AND job IS NOT NULL AND re_hours IS NOT NULL AND overtime IS NOT NULL AND total_hours IS NOT NULL
    AND line_date IS NULL AND item IS NULL AND rate IS NULL AND quantity IS NULL)
  OR (kind = 'item' AND line_date IS NOT NULL AND item IS NOT NULL AND rate IS NOT NULL AND quantity IS NOT NULL
    AND job IS NULL AND re_hours IS NULL AND overtime IS NULL AND total_hours IS NULL
    AND line_total = round(rate * quantity, 2))
);
ALTER TABLE invoice_lines DROP COLUMN IF EXISTS ot_rate;
ALTER TABLE invoice_lines DROP COLUMN IF EXISTS ot_hours;

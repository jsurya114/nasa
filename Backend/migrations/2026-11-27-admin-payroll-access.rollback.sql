-- Removes the per-admin Payroll switch. Admins who had it lose the Payroll page; the entries they made are not changed or deleted
-- (they stay visible to the super admin, with who made them).
ALTER TABLE admin DROP COLUMN IF EXISTS can_use_payroll;

-- Removes the per-admin Invoices switch. Admins who had it lose access to Invoices; their invoices are not deleted (and stay visible to the super admin).
ALTER TABLE admin DROP COLUMN IF EXISTS can_use_invoices;

-- Invoices for selected admins. Until now only the super admin could use Invoices. The super admin can now switch it on for single admins.
-- Additive: one new column on admin, off for everyone. Nothing existing changes, and no invoice, vendor or role changes.
--
-- admin.can_use_invoices  true = this admin may use Invoices (and sees only the invoices they created). A super admin never needs it.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Run BEFORE deploying the code that reads the column (the admin list asks for it).
-- Safe to run more than once. Rollback: the .rollback.sql file next to this one.

ALTER TABLE admin ADD COLUMN IF NOT EXISTS can_use_invoices boolean NOT NULL DEFAULT false;

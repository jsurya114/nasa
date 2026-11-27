-- Payroll for selected admins. Until now only the super admin could open the Payroll page. The super admin can now switch it on for single admins.
-- Additive: one new column on admin, off for everyone. Nothing existing changes, and no ledger entry, pay run, payment or role changes.
--
-- admin.can_use_payroll  true = this admin may use the Payroll page (advances, hand-entered claims, expenses, reimbursements, corrections, repayments,
--                        and the drivers' statements and balances) for the cities assigned to them. Pay runs, payments, Everee and QuickBooks stay
--                        super admin only, and so do waivers. A super admin never needs it.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Run BEFORE deploying the code that reads the column (the admin list asks for it).
-- Safe to run more than once. Rollback: the .rollback.sql file next to this one.

ALTER TABLE admin ADD COLUMN IF NOT EXISTS can_use_payroll boolean NOT NULL DEFAULT false;

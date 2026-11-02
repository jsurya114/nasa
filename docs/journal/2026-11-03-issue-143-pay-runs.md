# Pay runs: draft, finalize, discard, void, and the recovery limit (issue #143, part 2)

- **Date:** 2026-11-03
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #143 (part of #138) / see the pull request for this branch. Stacked on #147 → #148 → #149 and #150.
- **Branch:** `feat/payroll-pay-runs` (from `feat/payroll-driver-ledger`, with `feat/payroll-pay-run-calculator` merged in)
- **Type and scope:** feat(payroll)
- **Files touched:**
  - new: `Backend/migrations/2026-11-03-issue-143-pay-runs.sql` and `.rollback.sql`, `Backend/services/payroll/payRuns/payRunStore.js`, `Backend/controllers/payroll/payRunController.js`, test `Backend/tests/payRunStore.test.js`;
  - changed: `Backend/routes/payrollRoutes.js` (new routes), `Backend/services/payroll/ledger/ledgerStore.js` (a used entry cannot be voided);
  - this journal entry.
  
  No reserved files are edited. `payment_dashboard` (Jasil's zone) is only **read**.

**What and why.** A pay run is one city, one period (at most 31 days), daily or weekly. It reads closed, unpaid pay rows exactly as the dashboard finds them (route's city, the same daily/weekly rule), and makes one frozen statement per driver with `payCalculator.js` (#150).

Policies follow the owner's **proposed** policy of 3 Nov 2026, recorded on #143, **not yet confirmed with the client**:
- **The recovery limit is the switch.** It is stored in `payroll_settings` and starts empty, so nothing is recovered automatically and each statement says so. Only a super admin can set it, with a reason, and every change is kept in `payroll_settings_history`. A run keeps a copy of the limit it used.
- **Pending (unresolved or ambiguous) claims are never deducted.** Only matched, chargeable ones are, oldest first. The run shows how many claims are pending and how many ledger entries need review.
- **Debits without a repayment arrangement** are flagged and wait. Instalments are taken one per run.
- **Reimbursements** (and credit corrections) are paid once.

Exactly once:
- **Pay rows and reimbursements:** a partial unique index lets a pay row be earned on only one live statement, and a reimbursement be paid once. A draft holds its rows, so a second run of the same period gets none.
- **Claims and debits:** they can be recovered over several runs. Each run reads what is still owed under a row lock, and one run is built at a time per city (advisory lock), so two admins cannot take the same amount.
- **Retries:** the same request ID returns the first run.
- **Amended claims:** what is still owed counts deductions taken for *every* version of the claim, so a claim amended from 40 to 45 after 40 was deducted costs only 5 more (found by an automated security review).
- **Voids versus runs:** a ledger void takes the city's payroll lock before anything else, the same lock a run is built under, so a run cannot pick up an entry that is being voided at that moment (found by an automated security review).

Frozen history:
- Statement amounts cannot change (trigger), and a check makes net = gross − insurance + reimbursements − claims − recoveries.
- Lines can't be edited or deleted; the only change allowed is releasing one when its run is discarded or voided.
- Only payout fields (for #31) can be set.

Lifecycle:
- `draft` → `finalized`. Repeating it is harmless. A statement below zero blocks finalizing.
- A draft can be **discarded** (releases everything).
- A finalized run can be **voided by a super admin only**, with a reason, and **only while no payout is submitted, paid or unconfirmed**. Uncertain outcomes must be reconciled first (#31), so a deduction is never released twice.
- A ledger entry already used by a live run can no longer be voided; it needs a correction entry.

Not in this part: marking pay rows paid or sending money (#144 and #31). The screen comes later.

**API** (`/admin/payroll`):
- `GET /settings`
- `PUT /settings/recovery-limit` (super admin)
- `GET /runs?cityId=`
- `POST /runs`
- `GET /runs/:runId`
- `POST /runs/:runId/finalize`
- `POST /runs/:runId/discard`
- `POST /runs/:runId/void` (super admin)

**Database.** Additive: five tables (`payroll_settings`, `payroll_settings_history`, `pay_runs`, `pay_statements`, `pay_statement_lines`), two guard triggers and indexes. Run after the #141 and #142 migrations. Back up first, test on a copy; safe to run twice. Rollback: `...pay-runs.rollback.sql` deletes all runs and settings history, so back up first. **Not for production** until the client confirms the policies.

**Config and dependencies.** None. Developer test switch `PAYROLL_TEST_DB=1`.

**Money impact.** None to existing pay. Nothing marks rows paid or pays anyone.

**Golden comparison** (synthetic rows): with no claims or ledger entries, statements equal today's driver payment minus insurance. Driver A has 3 × (100.00 − 1.92) = 294.24, driver B has 80.50, and the run total is 374.74 plus the 12.25 reimbursement = 386.99.

With a 100% limit, driver A:
- available: 300.00 − 5.76 + 12.25 = 306.49;
- deducted: claim 40.00 and instalment 50.00;
- net: 216.49;
- carried forward: 180.00.

**Tested.**
- **Database test** against the local copy, all in one transaction that is always rolled back (three migrations plus made-up city, route, admins, journeys, pay rows, claim and ledger entries). 10 steps, all pass:
  - the totals above with no limit; nothing deducted, everything carried, flags shown, a row after the period left out;
  - the same request returns the same run, and a second draft gets no held rows;
  - wrong-city admins cannot make or read a run, and only a super admin can set a valid limit, with a reason;
  - with the limit, the claim and one instalment are taken and the unplanned debit waits; the change is recorded;
  - finalize, finalize again (harmless), no discard after finalizing, and used ledger entries cannot be voided;
  - the next week takes instalment 2 and never the claim, a row or the reimbursement again;
  - statements and lines cannot be edited or deleted, but payout fields can be set;
  - void: super admin only, blocked while a payout is unconfirmed, then everything is released and can be taken again;
  - a statement below zero blocks finalizing.
- The claims and ledger database tests still pass: 27 database steps in all.
- **HTTP** against a temporary backend from this branch, stopped afterwards, with tokens for made-up accounts:
  - 401 without a token; 403 for a driver;
  - 400 for a missing city, a bad body or a period over 31 days;
  - 403 for another city, and for a city admin changing the limit;
  - 400 for a void without a reason and for a bad run ID;
  - no tokens in the log.
- Whole backend suite: 51 run and pass, 35 database tests skipped as before.

**Not tested.**
- Real production pay data (the golden comparison used synthetic rows; it must be repeated on a copy of real data before use).
- Two admins at the same moment (locks and unique indexes in place, not run in parallel).
- Weekly runs with real GOFO rows.
- Payout (#31).
- The screen.

**Risks and follow-ups.**
- The client must confirm the recovery limit, the instalment defaults and the policies on #143 before a super admin sets the limit in production.
- A driver whose only activity in the period is a reimbursement gets no statement until they also have pay rows.
- Run the golden comparison on a restored copy of production for one real week per data type before relying on it.
- #145 shows these statements to drivers and admins.

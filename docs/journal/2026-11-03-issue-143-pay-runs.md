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

## Review fixes (Jasil's review on #152, 3 Nov 2026)

Each case below is reproduced in the new `Backend/tests/payRunReview.test.js` (8 cases, including the city scoping, each in its own rolled-back savepoint). Six of them fail on the code before this fix. The seventh, "a discarded draft frees its instalment", is a guard that passes before and after.

1. **Future repayments lowered today's recovery.** Repayments made outside payroll now count only once they are in effect: effective date and intended payday on or before the run's last day, the same rule reimbursements use. A $100 repayment dated 2027 no longer cuts a November recovery from $200 to $100.
2. **Repayments are now auditable.** Each repayment a statement relies on gets a `repayment` line with the amount used, oldest repayment first. These lines are audit only and move no money. Because the entry is on a live run, it cannot be voided until that run is discarded or voided. Schema change in this pull request's migration: `pay_statement_lines.line_type` allows `repayment`, which must be positive and name its ledger entry.
3. **A second run in the same period took another instalment.** An entry is now recovered at most once per pay period: a run skips any entry already recovered on a live run whose period overlaps its own. That covers supplemental runs, a second run of the same week, and daily and weekly runs over the same days. The entry is flagged `already_recovered_this_period` and stays owed. Discarding or voiding the earlier run frees it. Runs of one city are built one at a time, under the city payroll lock, so two runs cannot both pass this check. The same rule covers "all on the next payday".
4. **A lowered claim disappeared.** When a driver had more deducted for a claim than they now owe, their next statement carries a `claim_over_recovered` flag with the claim and the amount. That happens when the carrier lowered the claim, made it exempt, or it now belongs to another driver. Nothing is refunded automatically: the refund policy is not agreed. The flag stays until an approved **credit correction naming that claim** (waybill and claim type, #149) is recorded. That correction is then paid once, as a reimbursement, to the driver who was charged. A claim whose amended version is still unmatched is not judged yet. Only the run's own city counts: its runs' deductions and corrections recorded in that city. A city's run never reads another city's pay (found by an automated security review; tested). A claim later matched to another city is still flagged in the city that deducted it.
5. **An advance not marked as paid out was recovered.** Such advances are now held (`advance_not_disbursed`), stay owed, and are counted in the run's "waiting" summary (`advances_not_paid_out`). Only advances already paid out outside payroll are recovered at this stage.
6. **The ledger list showed the original amount as the debt.** `listEntries` now gives every entry:
   - `settled`: what finalized runs took or paid;
   - `reserved`: what a draft holds, released if the draft is discarded;
   - `outstanding`;
   - `pay_runs`: each run that used the entry, with its status and amount.

   Each driver's balance counts only settled amounts: positive means the driver owes, negative means NASA owes. The ledger store test now also applies the pay run migration.
7. **Smaller fixes.**
   - With no recovery limit set, items are no longer also flagged "limit reached"; the "no recovery limit is set" flag already says why.
   - Claims held for review (#148) count as waiting in a run's summary.

- **Money impact:** with no adjustments, statements are unchanged: gross − insurance, as before (the existing pay run tests pass unchanged). The changes only stop wrong recoveries: future repayments, a second instalment in one period, and advances not paid out. A lowered claim is flagged; nothing is paid back automatically.
- **Tests:** full backend suite 100 pass with the database, 58 pass without it (as CI runs), 0 fail. Calculator: 17, with 4 new for holds, repayment lines, over-recovery flags and the limit wording.

## Second review fix (Jasil's re-review on #152, 3 Nov 2026)

- **A refunded charge still counted as recovery.**
  - Before: what was still owed on a claim subtracted every deduction for any version from any driver. If A was wrongly charged 40, the claim moved to B, and A was refunded, A's deduction still cleared B's claim. B was never charged.
  - Now the amount owed is the eligible amount less what has **really been collected**: for each driver, live deductions minus refunds paid to that driver for this claim on a finalized run, never below zero per driver. The SQL is `NET_COLLECTED_SQL`, which the statement view (#153) shares, so both show the same figure.
  - Deductions held by drafts count, so nothing is taken twice. Refunds count only once finalized, so B is never charged while A's refund is still open.
  - Results: A unrefunded, B owes 0. A's refund finalized, B owes 40, once. A refunded 25 of 40, B owes 25, and A is still flagged for the other 15.
  - A's statements are never changed.
- **Void guard.** A finalized run that paid a claim refund cannot be voided once any later run has a deduction for that claim. The later run may have charged B because of the refund, and voiding would take the refund back while B's charge stands. The message asks for the claim to be reconciled first. "Later" means any run made after this one: stricter than "after it was finalized", never looser.
- **Payout states.** A refund paid on a finalized statement counts whatever its payout state: submitted, failed or unconfirmed are #31's to reconcile. A failed refund payout must be retried, not voided, while a later run relies on it, which the guard enforces.
- **Tests:** two new cases in `payRunReview.test.js`, both failing on the code before this fix.
  1. Full refund:
     - while A is unrefunded, B 0 and A flagged;
     - with the refund only in a draft, B still 0;
     - after it is finalized, B 40, and the next run 0;
     - the refund run then cannot be voided.
  2. Partial refund: B 25, and A still flagged for 15.
- Full backend suite: 102 pass with the database.
- **Not covered:** reassignment to a driver in another city. Collections and refunds are counted across cities by the same rule, but only same-city reassignment is tested.
- **Two more fixes from an automated security review.**
  1. *Refunds match one claim.* Refunds are now matched to a claim by courier, waybill and claim type (#149 `claim_courier`), in the net-collected figure, the over-recovery flag and the void guard. Tested: a GOFO refund leaves a SpeedX claim with the same waybill and type untouched (GOFO 0.00 collected, SpeedX 40.00).
  2. *Void versus a run being built.* Voiding now takes the run's city payroll lock, then locks the match rows of every claim the run refunds before the "relied on" check. A pay run building at that moment, in any city, locks the same rows while it reads claims, so the two are serialised: either the run finishes first and the void sees its deduction, or the run waits and then sees no refund. The locks are taken city first, then claims, in claim order, so they cannot deadlock. A true two-connection race is not reproduced in the rolled-back tests, which cannot share their tables with a second connection.
- Full backend suite: 103 pass with the database.

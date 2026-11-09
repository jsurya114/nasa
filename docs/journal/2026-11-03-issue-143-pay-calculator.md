# Pay statement calculator (issue #143, part 1)

- **Date:** 2026-11-03
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #143 (part of #138) / see the pull request for this branch
- **Branch:** `feat/payroll-pay-run-calculator` (from `develop`)
- **Type and scope:** feat(payroll)
- **Files touched:** new `Backend/services/payroll/payRuns/payCalculator.js`, new test `Backend/tests/payCalculator.test.js`, this journal entry. No reserved files. Nothing calls the calculator yet.

**What and why.** One pure function that works out a driver's statement for a pay run: earnings, insurance, reimbursements, claim deductions, ledger recoveries, net, and what carries forward. Part 2 stores pay runs and calls it. Keeping the money rules in one pure function means every rule is tested to the cent, and a retry recalculates exactly the same result.

Rules follow the owner's **proposed** policy of 3 Nov 2026, recorded on #143 and **not yet confirmed with the client**:
- **Never a negative payout.** Claims and recoveries are taken only up to the payday's recovery limit; the rest stays owed and carries forward. Nothing is erased.
- **The recovery limit is a setting** (`percent_of_available` or `fixed_amount`, where "available" = pay after insurance plus reimbursements). **While it is not set, nothing is recovered automatically**, and the statement says so. This is the switch that keeps automatic recovery off until the client confirms.
- **Repayment arrangements** from the ledger (#142): `full_next_payday` takes what is owed; `installments` takes the instalment (the last one only what is left). No arrangement means the entry is flagged `needs_review` and is not recovered.
- An entry dated after the run, or meant for a later payday, waits.
- Order: oldest matched claim first, then the oldest debit.
- Repayments made outside payroll lower the oldest debts first.
- Pending (unmatched) claims are never an input, so they are never deducted.
- Money is in whole cents throughout; text amounts with more than two decimals are refused.

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None yet (nothing calls it). With nothing owed, a statement equals today's net, gross minus insurance: three days of 100.00 with 1.92 insurance give 294.24, the same as the dashboard's driver payment minus insurance.

**Tested.** 13 new unit tests:
- cents arithmetic;
- no debts equals today's net;
- no limit set: nothing recovered, everything carried, flagged;
- $200 as $50 over four paydays, then nothing;
- the last instalment takes only the remainder;
- a 50% limit with a 100 claim and a 500 advance: claim first, 47.12 of the advance, net 147.12, 452.88 carried;
- a fixed limit never above the pay, and no pay means nothing taken;
- no arrangement: flagged, not recovered;
- not yet due (later date or later payday);
- reimbursements paid and counted in the available amount;
- outside repayments applied to the oldest debts first;
- insurance larger than pay is flagged, with nothing recovered;
- the same input always gives the same statement, oldest claim first.

The whole backend suite passes.

**Not tested.** Real pay data (part 2 compares against stored pay rows).

**Risks and follow-ups.**
- Every policy above needs the client's confirmation before the recovery limit is set in production.
- A statement with a negative net (insurance larger than pay) must block finalizing; part 2 enforces that.

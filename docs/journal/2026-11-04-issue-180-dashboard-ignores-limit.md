# The dashboard's Penalty & Others no longer waits for a recovery limit (issue #180, follow-up)

- **Date:** 2026-11-04
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #180 / see the pull request for this branch
- **Branch:** `fix/dashboard-ignores-recovery-limit` (from `develop`)
- **Type and scope:** fix(payroll), backend
- **Files touched:** `Backend/services/payroll/statements/periodSummary.js`, test `Backend/tests/periodSummary.test.js`; this entry. No reserved files.

**What was reported.** After entering a record on the Payroll page, the dashboard still showed Penalty & Others as $0.

**Cause.** The dashboard's figure comes from an estimate that runs the pay calculator. The calculator takes nothing while no recovery limit is set (the default), so the figure stayed at $0 and only a note explained why.

**The change.** The estimate now caps what it shows at the driver's available pay (100%), whatever recovery limit the pay runs use. Each record still follows how it was created (all on the next payday, or its instalment), weekly carrier claims still apply only to weekly pay, and a record that is not yet due still says so. Draft and approved pay runs are untouched: they keep applying the recovery limit, and once one exists the dashboard shows its own frozen figures.

**Money impact.** Dashboard display only. No pay run amount, statement or ledger row changes. Local driver with a $10 penalty (full next payday) and $162 of weekly carrier claims, no limit set: Penalty & Others before $0.00 (net $825.13), after $172.00 (net $653.13).
**Known difference.** With no limit set, the dashboard now shows an amount that a pay run created at that moment would not take. Setting the limit on the Pay runs page makes the two agree. With a limit below 100%, the estimate is higher than what the run will take, until the run exists.

- **Database:** None. **Config and dependencies:** None.

**Tested.** `periodSummary.test.js` (17 tests, database): with no limit the estimate shows 25 claim + 75 recovered = 100; with a 10% limit and with no limit a $60 penalty on $100 pay shows $60.00 deducted and $40.00 net. Against the local database in a read-only run: $172.00 and $653.13 with the limit still empty. Whole backend suite with both database flags: 266 pass, 4 fail; the same 4 fail on `develop` without this change (the claims-store test, count 4 where 3 expected, likely from the real claims in the local database; not checked on an empty database).

**Not tested.** By hand in the browser; frontend suites (no frontend file changed).

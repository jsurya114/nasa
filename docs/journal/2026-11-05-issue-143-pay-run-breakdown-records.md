# Pay runs: the full breakdown names each advance, its instalment and what was taken

- **Date:** 2026-11-05
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #143 (pay runs), requested in chat / see the pull request for this branch
- **Branch:** `fix/pay-run-breakdown-records` (from `develop`)
- **Type and scope:** fix(payroll), backend and frontend
- **Files touched:** `Backend/services/payroll/payRuns/payRunStore.js` (`getRun`, one added helper), `payCalculator.js` (one flag gains a list of record IDs), `Frontend/src/components/Admin/payRuns/StatementRecords.jsx` (new), `RunDetail.jsx` (one line), tests `payCalculator.test.js`, `payRunStore.test.js`, `RunDetail.test.jsx`. No reserved files.

**What was wrong.** A driver had a $100 advance repaid in instalments of $50, dated the day it was entered. The pay run covered earlier delivery dates, so the advance was dated after the run's end, and the calculator correctly left it for a later run. But the "Full payment breakdown" showed only the totals, so nothing on screen named the advance or its instalment, and the only hint was a general yellow note. The same happened when no recovery limit was set: the flag said so without naming the record.

**What changed.**
- `getRun` now returns, for each statement, `records`: the ledger records (advances, penalties, reimbursements) that statement has a line for or that its flags name, each with type, direction, amount, repayment plan, instalment amount, date, reason and `taken` (what this statement recovered from it). Additive field; existing fields and shapes are unchanged. It reads what the run froze (lines and flags), so an old run reads the same later.
- The `recovery_limit_not_set` flag now also carries `entryIds`, the debits that were waiting. This is information only: no amount, limit or rule changed.
- The breakdown shows a new section "Advances, penalties and other records": for each record, its date and amount, how it is repaid ("repaid in instalments of $50.00"), what was taken in this run, and, when nothing was taken, why (dated after the run ends, or no recovery limit is set, or the held/limit message from the server).

**Database, config, dependencies:** none. **Money impact:** none; no calculation changed, only what is displayed and the extra list on a flag.

**Tested.** Backend suite with `PAYROLL_TEST_DB=1`: 344 pass, 0 fail (36 skipped need other settings). New assertions: the advance appears with its plan and instalment and `taken` 0 when no limit is set, 50.00 once a limit is set; the flag names the advance; a driver with no records gets an empty list. Frontend: 245 pass, build works; new cases for a not-yet-due advance and for an instalment taken, with and without a reason. Also loaded a real draft of the local copy through the changed `getRun`: the advance showed with $100, instalments of $50, dated 2026-11-04, $0.00 taken.

**Not tested.** Not looked at in a browser. Drafts made before this change have no `entryIds` on the no-limit flag, so for those only records that have a line or a named flag appear; make a new draft to see everything.

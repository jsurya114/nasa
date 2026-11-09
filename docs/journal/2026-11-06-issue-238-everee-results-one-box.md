# Show all Everee payments of a pay run in one box (issue #238)

- **Date:** 2026-11-06
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #238 / see the pull request for this branch.
- **Branch:** `fix/everee-results-one-box`
- **Type and scope:** fix(payroll), frontend only
- **Files touched:** new `Frontend/src/components/Admin/payRuns/everee/mergeBatches.js` and `mergeBatches.test.js`; changed `everee/EvereeRunResults.jsx`, `everee/EvereeBatchResults.jsx`, `everee/EvereePay.test.jsx`. None are reserved files. The payment flow is Jasil's area (see `docs/OWNERSHIP.md`): he reviews this.

**Why.** A pay run can be paid in several goes (one driver now, two later, everyone else after that). Everee keeps each go as its own batch, and the "Pay to drivers" window drew one box per batch, so one run showed many boxes. It now shows one box per run that lists every driver paid so far, and a driver paid later joins the same box.

**What changed.**
- `mergeBatches` joins the batches the server already returns for a run into one view: counts added up, drivers and total added up (in cents), all drivers in one list sorted by name, the header naming the number of payments and the latest send time. With one batch the view is unchanged.
- "Check now" now checks every batch that is still waiting or has a returned deposit; "Retry what failed" retries every batch that can be retried. Batches that need neither are not touched.
- A driver can appear in only one batch (one payment item per statement), so no one is listed twice.

- **Database:** None. **Config and dependencies:** None. **API:** unchanged (`GET /runs/:id/everee-batches` still returns one view per batch). **Money impact:** None. Nothing about amounts, who is paid or how changed; the total shown is the sum of the batch totals the server reports.

**Tested.** Unit tests for the merge (single batch, several batches, exact cents, which batches an action reaches); a screen test with three separate sends showing one box with all four drivers and the combined header, "Check now" calling only the waiting batches and "Retry" only the batch with a failed driver. All 50 pay-run frontend tests pass.

**Not tested.** In a real browser, and against a run with real multi-batch history in the local database.

**Risks and follow-ups.** The list now has no per-send divider, so the time a particular driver was sent is not shown; add it to each row if the team wants it.

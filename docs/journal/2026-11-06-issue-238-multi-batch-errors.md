# Handle each Everee batch on its own in the single results box (issue #238)

- **Date:** 2026-11-06
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #238 / PR #239 (review by Jasil: P1)
- **Branch:** `fix/everee-results-one-box`
- **Type and scope:** fix(payroll), frontend only
- **Files touched:** `Frontend/src/components/Admin/payRuns/everee/EvereeRunResults.jsx`, `everee/EvereePay.test.jsx`. None are reserved files; the payment flow is Jasil's area.

**Why.** The one results box runs "Check now" and "Retry what failed" across several batches, but the loop sat inside one try/catch. One refused batch (for example a retry that needs an earnings review) stopped the loop, so later eligible batches were never tried, and a failure after a success skipped the refresh of the results.

**What changed.**
- Every batch is tried on its own; a refusal for one never stops the others.
- The server's refusal words are kept as they are and shown in a list that names the drivers of each refused batch ("Gus Test: Review the earnings before retrying"), with a line saying the others were tried.
- The results are always read again after the attempts, whatever happened, and the page is told (`onChanged`) when at least one batch went through.
- A refused operation is not tried again by itself. No server rule was relaxed; the server still decides every retry and check.

- **Database, config, dependencies, money impact:** None.

**Tested.** Two new screen tests: first batch refused and later one goes through (the second request is sent, the refusal is shown, the paid driver appears after the refresh, the refused batch is not retried by itself); first batch goes through and the later one fails (results refresh, failure names the driver, Check now stays available). Both fail on the old code and pass now. All 52 pay-run frontend tests pass.

**Not tested.** In a real browser; against the real Everee API.

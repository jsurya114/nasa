# Read-only review of a city payment batch (issue #144, part 1)

| Field | Value |
|---|---|
| Date | 2026-11-03 |
| Author | Jasil (with Claude Code) |
| Issue / PR | `#144` / see the pull request for this branch |
| Branch | `feat/pay-batch-review` |
| Type / scope | `feat(payroll)` |
| Files touched | New: `Backend/services/payroll/payRuns/payBatchReview.js`, `Backend/controllers/payroll/payBatchController.js`, `Backend/tests/payBatchReview.test.js`. Edited: `Backend/routes/payrollRoutes.js` (import and one route). |
| Reserved files touched | `payrollRoutes.js` is in the payroll area (Jayasoorya): three added lines, no existing line changed. |

**What and why.** #144 asks for a reviewed, confirmed, city-wide payment. This first part is only the review: `GET /admin/payroll/runs/:runId/batch-review`. It reads the statements frozen on a pay run (#143) and returns, per driver, the itemised amounts, the payout status, and a list of blockers; plus a summary of who is eligible and the eligible totals. It changes nothing, records nothing and pays no one (`readOnly: true`).

- **Population by immutable IDs.** The drivers are the statements of the run, found by run ID on the server. No name, page, or client-sent list decides who is in.
- **City scope on the server.** The run's city is checked with the same `assertCityAllowed` the pay-run API uses; another city's admin gets 403.
- **Blocking** (driver is not eligible): the run is not finalized; the net is below zero; the statement is already paid; a payment is submitted or unconfirmed (reconcile first).
- **Disclosed** (does not block, shown to whoever confirms): claims of this driver not matched yet (so not deducted), an earlier payout that failed, and every flag the calculator set (undisbursed advance, no repayment arrangement, recovery limit not set, ...).
- **Eligible totals** add up only eligible drivers, to the cent, using the calculator's cent helpers.

**Not in this part (and why).**
- Include/exclude of drivers on a draft, the final confirmation, "Record external payment", per-driver results and duplicate-request protection: they write data, and several depend on owner decisions.
- "Submit to Everee": that is #31 (Jayasoorya). There is no worker mapping in the database yet, so a missing mapping cannot be reported; it will be one more blocker when #31 lands.
- The DFW tracking-interruption exemption is not shown per driver yet; the review shows only claims still waiting. Exempt claims are decided and carry no deduction.
- No screen.

**Decisions needed from the owner before the write steps.** (1) A negative net: block (as finalize does now) or carry forward? (2) Unresolved claims at payday: pay and keep them open, or hold the driver? (3) Advance instalments: fixed amount or percentage. (4) May one admin both confirm and record the payment? Not decided here.

**Money impact.** None. Read-only.

**Database.** None.

**Tested.** Unit tests for the blocker rules. A database test on a private scratch copy (one rolled-back transaction, made-up data): a draft run has nobody eligible; a driver whose insurance exceeds the pay is blocked as negative; reading the review changes no row; another city's admin is refused (403); unknown run is 404; a finalized run shows its driver eligible with the exact total; marking the statement submitted makes the driver blocked and the eligible total zero. Removing the city check fails the database test. Default backend suite: 0 failures.

**Not tested.** Over HTTP with real tokens; the first part has no UI.

# Everee payments: one super admin may approve, preview, confirm and retry (issue #31)

- **Date:** 2026-11-05
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #31 (rule also in #161 and #213) / see the pull request for this branch. This is "PR A" of Jasil's 2026-11-05 plan (Slack, driver onboarding hand-off).
- **Branch:** `feat/single-super-admin-payment` (from `develop`)
- **Type and scope:** feat(payroll), backend and frontend
- **Files touched:** `Backend/services/payments/everee/batchPreview.js`, `batchSubmit.js`; `Frontend/src/components/Admin/payRuns/everee/EvereePreview.jsx`; tests `evereeBatchPreview.test.js`, `evereeSubmit.test.js`, `EvereePay.test.jsx`. No reserved files.

**Owner decision.** There is only one super admin, the NASA owner. The earlier rule "the person who finalized a run cannot confirm its Everee payment" would have needed a second account, so it is removed. The same authenticated super admin may now approve (finalize) a run, preview it, confirm the payment and retry a definite failure. No second admin or dummy account is needed.

**What changed.**
- The preview no longer computes who finalized the run, and no longer returns `confirm: { allowed, reason }`. The message "you finalized this run; another super admin has to confirm the payment" is gone from the preview, from the confirm check and from the retry check (`submitBatch`, `retryBatch`), and from the preview screen.
- The `finalized_by` read in the retry was dropped because nothing used it any more.
- Response shape: the preview no longer has the `confirm` field. The only reader was the Everee preview component, updated here.

**What did not change** (kept on purpose, as Jasil listed): the explicit preview plus final confirm click, super admin only (a city admin is still refused), the frozen statement net, the environment and live gates, reservation, lease and run/city/statement locks, request-ID idempotency, the preview hash, the unknown-outcome protection, the permanent audit and "paid only when the deposit is verified". Both actors stay recorded, even when equal: `pay_runs.finalized_by` (who approved the run) and `everee_payment_batches.created_by` (who confirmed the payment).

**Not changed, and not assumed.** Everee's own approval of a hosted payroll run in its portal is a separate step. The same owner can approve there, but removing NASA's second-person check does not remove that step, and automatic approval would need Everee's confirmation and configuration. The newer payroll execution API is not assumed to exist. The combined "Pay to drivers" button and the Reference field (#213) are a separate decision and are not part of this change.

**Database, config, dependencies:** none. **Money impact:** none; amounts, deductions and debt are untouched.

**Tested** (PAYROLL_TEST_DB, rolled back, fake Everee): the old assertions that the finalizer was refused are replaced. New: the finalizer previews the run with the same hash and no `confirm` field; one super admin finalizes, previews, confirms a batch with one refused payable, retries it, and both `finalized_by` and `created_by` are that admin; a city admin is still refused. Both new tests fail with the old code restored (checked) and pass now. Frontend: the confirm button is disabled only when the batch is blocked. Backend suite and frontend suite pass; the frontend builds.

**Not tested.** A real sandbox payment, the Everee portal approval, and the screens in a browser.

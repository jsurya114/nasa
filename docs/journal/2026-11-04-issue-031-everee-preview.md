# Everee, PR 3: the read-only preview of a payment batch (issue #31)

- **Date:** 2026-11-04
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #31 / see the pull request for this branch (stacked on PR 1, #197)
- **Branch:** `feat/everee-preview` (from `feat/everee-workers`)
- **Type and scope:** feat(payroll), backend (no screen yet)
- **Files touched:** new `Backend/services/payments/everee/batchPreview.js`, `Backend/controllers/payroll/evereeBatchController.js`; edited `evereeConfig.js` (the payments switch), `Backend/routes/payrollRoutes.js` (one route), `Backend/.env.example` (one name); tests `evereeBatchPreviewRules`, `evereeBatchPreview`; this entry. It reads (does not change) `payBatchReview.js`, which is Jasil's #144 part 1. No reserved files.

**What it is.** `GET /admin/payroll/runs/:runId/everee-preview`, **read-only and super admin only** (and the run's city is checked). It is what the person confirming looks at before any money is sent (#144: no blind transfer): who would be paid, how much, the total, what blocks anyone and why, and a fingerprint of exactly what would be paid. It calls nothing at Everee, writes nothing and pays no one.

**It builds on the #144 batch review** (the run's frozen statements by ID, blockers for an unfinalized run, a negative net, a payment already submitted or paid, flags and earlier failures disclosed, claims waiting in the city) and adds Everee's rules, as agreed by Jasil on #31:
- **Blocks:** net below zero; a payment already submitted, unconfirmed or paid; the run not finalized; **no Everee worker linked** (with the hint "link a worker" or "fix the driver's data first" when the name has one word or there is no valid phone); the **worker not ready** (onboarding incomplete, tax-ID check failed, or left), each named; and a net of exactly **$0.00** (nothing to pay).
- **Warns, does not block:** claims waiting in the city, earlier failed attempts, the statement's own flags.
- **Who may confirm:** only a super admin, and not the person who finalized the run; the preview tells the viewer whether they may (`confirm.allowed` and why).
- **The amount** is each statement's frozen net. Nothing is recalculated. The total adds only the drivers who can be paid, to the cent.
- **Batch-level blockers:** run not finalized; payments switched off; nobody can be paid. `canSubmit` is true only when none applies.
- **`previewHash`:** SHA-256 of the run, the environment and, for each payable driver, the statement, the amount in cents and the Everee worker. The same facts give the same hash for whoever looks; a driver, an amount, an Everee worker, the run or the environment changing gives another. The confirm step (next part) sends it back; if it no longer matches the server answers 409 and shows a new preview.
- **Payments switch:** `EVEREE_PAYMENTS_ENABLED` must be exactly `true`, else the batch is blocked ("payments are switched off") while the preview still works. It is off by default, so setting up the connection, linking workers and previewing can never make a payment possible by accident. Production also needs a production token and `EVEREE_ENVIRONMENT=production` and, until Jasil approves going live, is not switched on.
- With no Everee settings the preview names no environment and has no hash. No email or phone is returned.

- **Database:** None. **Dependencies:** none. **Money impact:** none (nothing is paid or changed).
- **Config:** one new name in `.env.example`: `EVEREE_PAYMENTS_ENABLED`.

**Tested.** Pure (3): the hash (order, each field, run, environment), the worker problems, the payments switch (only exactly `true`; production needs its own setting). Database with real pay runs, rolled back (9 steps): only a super admin, 404; an unfinalized run (and a negative net) says why; a finalized run with a driver in each state (ready, onboarding incomplete, not linked, one-word name, $0, already submitted) gets the right blockers and hints; the total of the eligible nets only ($125.50); the switch; the finalizer may not confirm; the hash changes when a driver becomes payable or the Everee worker changes; a sandbox link is not a production link and a worker who left is blocked; previewing changes no row. Removing the worker-ready blocker makes 5 steps fail, and letting the finalizer confirm makes 1 fail (checked). Backend suite: 317 pass, 4 fail; the same 4 claims-store tests fail on `develop` without this change.

**Sandbox evidence.** None is needed: the preview makes no call to Everee. It uses the sandbox links made in PR 1 (the local copy holds one ready sandbox test worker). The local copy has no pay runs (the data was cleared), so the preview was exercised on made-up runs inside the tests, not on real data.

**Not tested.** On a real pay run from real data; no screen (the dashboard Pay button is the last part).

**Next.** PR 4: the confirm step that submits the batch (after #197 and #200 are merged): payables with a stable external ID per statement, one payout request limited to this batch, per-driver results, the duplicate guards and a lock.

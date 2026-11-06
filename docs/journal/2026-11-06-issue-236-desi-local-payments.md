# Pay Desi and Local drivers differently (issue #236)

- **Date:** 2026-11-06
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #236 / see the pull request for this branch.
- **Branch:** `feat/desi-local-payments`, **stacked on `feat/driver-type-bulk-change` (PR #233, issue #232)**: it needs the driver type column. This branch contains #233's commit; when #233 merges, rebase onto `develop` and that commit drops out.
- **Type and scope:** feat(payroll), backend, database and frontend
- **Files touched:** new `Backend/migrations/2026-11-06-issue-236-payment-driver-type.sql` and `.rollback.sql`, `Backend/services/payroll/payRuns/driverPaymentRules.js`, `Backend/tests/driverPaymentRules.test.js`, `Frontend/src/components/Admin/payRuns/DriverTypeTabs.jsx`, `driverTypes.js`, `DriverTypeTabs.test.jsx`; changed `Backend/services/payroll/payRuns/payBatchReview.js`, `paymentRecords.js`, `Backend/services/payments/everee/batchPreview.js`, `batchSubmit.js`, `Frontend/src/components/Admin/payRuns/RecordPaymentDialog.jsx`; tests updated: `paymentRecords`, `payBatchReview`, `evereeBatchPreview`, `evereeSubmit`, `evereePaymentStatus` (backend), `PaymentRuns.test.jsx`, `EvereePay.test.jsx` (frontend). **`RecordPaymentDialog.jsx`, `PaymentRuns` and the payment flow are Jasil's area** (see `docs/OWNERSHIP.md` and the journal of #213): he reviews this.

**Why.** Desi drivers must never be paid through Everee; only Local drivers can be. Admins also need to pay the two groups separately.

**The rule, enforced on the server for every payment (not only on the screen).**

| Driver type | Cash in Hand | Everee |
|---|---|---|
| Local | yes | yes |
| Desi | yes | **never** |
| Not set | **no** (blocked until an admin sets Local or Desi) | no |

- One shared rules module, `driverPaymentRules.js` (`methodAllowed`, `typeBlockers`, `evereeTypeBlockers`).
- **Batch review** (`reviewRunAsBatch`, which every payment path builds on): each driver now carries `driverType`, and a driver with no type gets the blocker `driver_type_not_set`.
- **Cash in Hand** (`recordRunPayment`): re-reads the drivers under a share lock (their type cannot change until the payment is written), refuses the whole selection with 409 if any selected driver has no type (nothing written, all or nothing), and accepts only `cash`.
- **Everee preview** blocks a Desi driver (`desi_not_everee`). **Everee send** (`submitBatch`) re-checks every driver's type under a share lock before reserving anything and refuses with 409 unless all are Local. **Everee retry** (`retryBatch`) does not send a driver who was changed to Desi after a failure; it notes why on the item.
- **Only two methods exist now:** Cash in Hand and Everee. The manual method list was Bank transfer, Cash, Other; **"Other" and the manual "Bank transfer" are removed** from the screen and refused by the server (`method` must be `cash`). Old receipts that used them are untouched and still read correctly. The database constraint still allows the old values for history. Jasil: please confirm that dropping "Other" is acceptable.
- **History keeps the type as it was.** New columns store the driver and their type at the moment of payment: `pay_run_payment_items.driver_id`, `.driver_type` and `everee_payment_items.driver_type`. Changing a driver's type later does not touch them (history is append-only; a database trigger already forbids updates). Rows from before this change stay NULL: nothing is backfilled or guessed.
- **One row per driver, as before:** every driver has their own payment item (statement, amount, driver, type, method and date through the record). The record is still one receipt for the drivers paid together; the items are not merged. Bulk cash is still one request that writes all the drivers' rows in one transaction.
- **Duplicates:** unchanged and reused: one item per statement for ever, request IDs make a repeated click or a lost answer safe, run and city locks, and "processing" and "paid" drivers are not selectable.

**The screen (Pay to drivers dialog).** Tabs **Local drivers (n)**, **Desi drivers (n)** and, only when some drivers have no type, **Not set (n)** (listed with "Needs a driver type", no checkbox, cannot be paid, with a pointer to the Drivers page). Each tab lists only its own drivers, with per-driver and select-all selection, the count and the total. Switching tab starts a fresh selection of that tab only, so one payment never mixes the types. **Desi:** the method is fixed to Cash in Hand (no dropdown, Everee never mentioned or called). **Local:** Cash in Hand or Bank transfer (Everee). The payment step lists the chosen drivers with their amounts (read-only), the method, count and total, then the existing note, date and confirmation for cash. The payment request now always sends the chosen driver IDs, never "everyone left", because the run can also hold drivers of the other type.

**The amount is not editable.** The owner chose to show the approved amount read-only: amounts come from the approved pay run (deductions, advances and paid history depend on it). No pay, rate or deduction logic changed.

- **Database:** additive nullable columns. Run `Backend/migrations/2026-11-06-issue-236-payment-driver-type.sql` (after the driver type migration; back up first, on a copy first; safe to run twice). Rollback: `...payment-driver-type.rollback.sql` (deletes the recorded types, not the payments). Applied to my local `nasa_local` after a backup of both payment item tables.
- **Config and dependencies:** None. **Money impact:** None. Amounts, deductions, statements and totals are not changed; the same approved nets are paid. Before and after totals for the same run are identical (tests check that the frozen amounts and debt are unchanged).

**Tested.**
- Backend, with a database copy (`PAYROLL_TEST_DB=1`, 90 tests, 0 failures): a Local and a Desi driver are paid in cash with one row per driver and the type stored, and changing a driver's type afterwards does not rewrite the stored type; a driver with no type blocks the review and refuses the whole selection with nothing written, while the typed driver alone can be paid; any method but cash is refused (request check and server); Everee preview blocks Desi and untyped drivers; Everee send sends only the Local driver and stores the type, a Desi-only selection sends nothing and reserves nothing; a failed Everee payment is not retried once the driver is Desi. Unit tests for the rules (`driverPaymentRules.test.js`). Existing payment, review, Everee preview, submit and status tests updated (their drivers now have a type) and pass.
- Frontend: 10 new tests (tabs and counts, Not set cannot be selected, selection per tab with count and total, switching tab, Desi fixed to Cash in Hand with no Everee call, Local offers exactly Cash in Hand and Everee, cash sends only the chosen IDs, Everee previews and sends only the chosen Local drivers, a failed payment keeps the dialog and reuses the request ID, processing and paid drivers are not selectable). Existing pay run and Everee screen tests updated and pass.
- Whole frontend suite 325 passed; backend suite without a database 0 failures (60 skipped, they need a database); build passes; lint clean on the changed files.

**Not tested.** In a real browser (the local browser was not signed in and I had no test login). A real Everee sandbox payment through the new rules (no Everee call was made in any test; all use a fake). Two database tests (`evereePaymentStatus` "scheduled check…" and `evereeSubmit` "a confirmed batch reserves…") fail on a copy of `nasa_local` because that copy holds my real sandbox payment; they fail the same way before this change and pass on a copy without those rows. A race between two admins changing a driver's type and paying at the same moment is covered by the share lock but was not tested with two real connections.

**Risks and follow-ups.**
- **Every driver is "Not set" today (732), so nothing can be paid until drivers are classified.** Use the bulk Change button on the Drivers page first.
- Drivers marked Desi who already have an Everee worker link keep it; the link is simply never used for payment.
- The type can be changed on the Drivers page while a driver's Everee payment is processing; the payment already sent is not affected, but a retry would then be refused (above).
- If Everee is later wanted for Desi drivers, the one place to change is `METHODS_FOR` in `driverPaymentRules.js`.

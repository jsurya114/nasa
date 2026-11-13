# Desi drivers are paid by check: a real `check` payment method

| Field | Value |
|---|---|
| Date | 2026-11-13 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / #288 |
| Branch | `feat/desi-drivers-paid-by-check` |
| Type / scope | `feat(payroll)` |
| Files touched | Backend: `services/payroll/payRuns/driverPaymentRules.js`, `paymentRecords.js`, `services/payments/quickbooks/quickbooksPayments.js`; migration `2026-11-13-payment-method-check.sql` (+ rollback); tests `driverPaymentRules`, `paymentRecords`, `quickbooksPayments`. Frontend: `payRuns/RecordPaymentDialog.jsx`, `driverTypes.js`, `quickbooks/QuickbooksResult.jsx`; tests `DriverTypeTabs`, `QuickbooksPay`. |
| Reserved files touched | None |

**What and why.** Desi drivers are paid by check, not cash in hand. The first version of this change only renamed the label; the review (rightly) pointed out that the saved payment still said `cash`, so receipts and QuickBooks results would disagree with the confirmation. Now the method is recorded:

- A new payment method `check` is allowed on a recorded payment. A Desi payment (with or without QuickBooks) is recorded as `check`. A Local driver cannot be paid by check (the server refuses it).
- A new Desi payment can only be a `check` (or the QuickBooks route, which records a check). The server refuses a new `cash` payment for a Desi driver, so an older client cannot mark Desi statements paid as cash. An older Desi cash request still replays its saved receipt, because a replay is answered before any type rule is checked, and nothing is rewritten.
- Receipts show the method that was recorded ("Check" or "Cash in Hand"). The QuickBooks batch view now returns `paidBy` for each item (read from the payment record), and its messages say "Paid by check" for a check and "Paid in cash" for older cash payments, so earlier batches are not relabelled.
- Local drivers are unchanged.

**Database.** `migrations/2026-11-13-payment-method-check.sql`: replaces the method CHECK constraint on `pay_run_payment_records` to allow `check` as well, in one `ALTER TABLE` statement (so the swap is atomic even in a plain `psql` run). No rows are changed. Re-runnable. Rollback: `2026-11-13-payment-method-check.rollback.sql`, also one statement: if a `check` row exists the whole statement is refused and the current constraint stays in place. **Apply the migration on production before deploying this code**; otherwise recording a Desi payment fails on the constraint.

**Config and dependencies.** None.

**Money impact.** None. No amount, rule or total changes; only the recorded method name and wording.

**Tested.**
- Backend on a local copy (`PAYROLL_TEST_DB=1 EVEREE_ONBOARDING_ENFORCED=false QUICKBOOKS_ONBOARDING_ENFORCED=false QUICKBOOKS_PAYMENTS_ENABLED=false`): `driverPaymentRules`, `paymentRecords`, `quickbooksPayments`: 29 passed, 0 failed. New: a check is recorded as `check` for Desi; a check for a Local driver is refused and writes nothing; a new Desi cash request is refused and writes nothing; an older cash request replays its receipt after the driver became Desi and writes nothing; the QuickBooks batch records `check` and the batch view reports `paidBy: check`. Tests that mixed Desi and Local in one cash payment now pay Desi by check and Local in cash.
- The full backend suite on the local copy also shows failures in unrelated files (claims, previews, reports, Everee submit). `evereeSubmit` fails the same on a clean `develop`; the others were not compared.
- Frontend admin tests: 41 files, 338 tests passed. New: a Desi payment sends `check`; an older cash batch still says "Paid in cash".

**Not tested.** By hand in the browser. The migration was run only on the local test copy.

**Risks and follow-ups.**
- Older receipts keep their stored `cash` method and still read "Cash in Hand"; that is the true record.
- With `QUICKBOOKS_PAYMENTS_ENABLED=true` in the environment, the `paymentRecords` DB tests that record a manual Desi check fail by design (manual Desi payments are refused then, they go through QuickBooks); run them with it off, as above.

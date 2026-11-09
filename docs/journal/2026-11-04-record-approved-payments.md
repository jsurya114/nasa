# Record completed driver payments

The Dashboard's old per-driver marking action changed delivery rows without settling the corresponding approved statements. Driver payments now use one approved-run action from either the Dashboard or the run detail.

## Admin workflow

1. Record advances and penalties before preparing the pay run.
2. Prepare and approve a run. Its driver amounts are frozen.
3. After drivers receive their money outside NASA, open **Mark all as paid** in Driver payments or the approved run.
4. In **Review drivers**, check the selected drivers and total. Deselect a driver to record a partial batch, then continue.
5. In **Payment details**, enter the paid date, payment method and reference or note, then explicitly confirm receipt. Changing the selection or payment details requires a fresh confirmation.
6. The receipt records who confirmed the payment and when. Partly paid runs remain awaiting payment; completed runs remain in Payment history.

This action records external payments. It never initiates a bank or Everee transfer. The Everee connection check remains separate.

## Money and records

- Use the run's frozen statement amounts and earning IDs; never recalculate at payment time.
- Update each selected statement and its included source/dashboard earning rows in one transaction.
- Keep deductions and remaining debt unchanged. Example: $100 earnings, $10 insurance and a $50 advance instalment produce $40 driver pay and $50 remaining debt before confirmation. After confirmation, the $40 is marked paid and the $50 debt remains.
- A second synthetic driver with $200 earnings and $10 insurance has $190 driver pay. Recording the first $40 produces a partly paid run with $190 remaining; completing the second payment records a total $230 without changing either statement.
- Store payment receipts and per-statement amounts in append-only tables. One statement has at most one manual payment item.
- Reuse the same request ID when retrying. The same request returns the original receipt; a changed payload under that ID is rejected.
- Block processing/unconfirmed payouts, negative statements and changed/already-marked earnings. Access is checked against the run's city.
- The legacy delivery-only payment endpoint returns a conflict directing the admin to this workflow. It cannot bypass the approved statement.

## Database setup

Back up the target database first. Apply `Backend/migrations/2026-11-04-approved-run-payment-records.sql` after the issue-143 pay-run migration. It adds two tables, indexes and history guards; no existing amounts or paid flags are migrated.

The rollback file refuses to remove populated payment history. Once a receipt exists, leave these additive tables in place when rolling application code back. Do not re-enable delivery-only marking as a workaround.

No new environment variables are required. No production migration or deployment is part of this change.

## Everee integration handoff (#31)

The Dashboard cards and approved-run payment status are the shared entry points. Keep **Pay with Everee** distinct from **Record completed payments**: the latter is an admin's confirmation of money already received outside NASA and must never initiate a provider call.

Existing manual-record routes:

- `GET /admin/payroll/payments/runs` lists city-scoped awaiting/history cards.
- `GET /admin/payroll/payments/runs/:runId` reviews frozen statements, blockers and manual receipts.
- `POST /admin/payroll/payments/runs/:runId/record` confirms an external payment using a request UUID, paid date, method, reference, explicit confirmation and optional statement IDs. The server determines every amount.

Connect Everee's preview/confirmation to the same run and immutable statement IDs. Preserve the provider-specific worker, environment, feature-switch and confirmer checks from its own implementation. Never recalculate earnings, deductions or debt when submitting or settling a payment.

The manual settlement currently owns the transaction that checks the frozen earning rows and updates `pay_statements`, `payment_dashboard` and `dashboard_data` together. Extract a shared internal completion operation when adding provider settlement, with separate evidence for admin confirmation and verified provider completion. Do not call the manual HTTP endpoint from a webhook or fabricate its admin attestation. Manual receipt tables are currently manual-only; provider attempt IDs, event evidence and audit history need their own additive storage or an explicit migration.

Submission and completion are separate states. Use the shared statement status to reserve a submitted payment; keep an unknown result unconfirmed and block manual marking or another transfer until reconciled. Only a verified successful provider completion should mark all three records paid. Use consistent run/city/statement locking between manual recording, provider submission, reconciliation and completion so simultaneous requests cannot both act on one statement. Keep network requests outside long database transactions; persist attempts and stable idempotency keys before sending.

The cards already show processing/unconfirmed counts and the manual form blocks them. Extend the history to show provider attempts, results and references alongside manual receipts; a provider-paid statement currently has only its paid status and no manual receipt. Reuse the same status after partial success, and retain unpaid/failed drivers for review.

Integration checks: manual confirmation racing provider submission; retries after a lost response; duplicate/out-of-order events; partial success; unknown outcomes; paid statements never resubmitted; city and confirmer scope; identical frozen amounts and remaining debt before/after completion. Keep sandbox and production evidence separate. No production payment switch is enabled by this handoff.

## Validation

- Database-backed tests cover scope, approval, selected membership, partial/all confirmation, replay, atomic rollback, processing payouts, changed earnings and unchanged balances/amounts.
- Independent concurrent-client checks cover the same request twice, different requests for one run, reused request IDs across runs, and disjoint selections.
- Frontend tests cover all/selected confirmation, lost-response retry, processing blocks, paid history and scoped Dashboard-to-run links.
- Visible desktop/mobile browser checks use a real local backend and a disposable database with synthetic records. They verify payment cards, both entry points, partial then complete payment, receipts, legacy-route blocking and the remaining advance balance.

The frontend suite passes 231 tests, the backend suite passes 288 tests with 33 skipped, and the eight payment-record tests pass with a database. Changed frontend files pass lint and the production build passes.

Manual login/logout across all three roles, journey start/finish and new SpeedX/GOFO uploads were not repeated for this change. Actual provider transfers were not tested. Existing local user records are not marked paid by the verification scripts.

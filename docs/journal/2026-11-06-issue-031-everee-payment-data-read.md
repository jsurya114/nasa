# Everee: read the payout statuses from the Payment Data API (issue #31)

- **Date:** 2026-11-06
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #31 / the pull request for `fix/everee-payment-data`
- **Branch:** `fix/everee-payment-data` (from `develop`)
- **Type and scope:** fix(payroll), backend
- **Files touched:** `Backend/services/payments/everee/evereeClient.js` (one read-only call), `Backend/services/payments/everee/paymentStatus.js`, test `Backend/tests/evereePaymentStatus.test.js`. No reserved files. The pure parser `paymentState.js` is unchanged.

**What happened.** In the Everee sandbox a payment was approved and Everee showed it as paid, and both webhooks (`payment.paid`, `payment-payables.status-changed`) arrived and were applied. The app still said "submitted", with the note "Everee's answer for this payment was not understood, so it is not marked paid". Nothing was wrongly paid; the safe rule did its job. But the sandbox round trip Jasil asked for could not finish.

**Cause.** After a payable is found to be in a payment, the app read the payment with `GET /integration/v1/workers/payment-history/{paymentId}`. The real answer of that call has the pay date, the worker, the amounts and a list of `deposits`, and **no payout statuses**. The parser expects `netPayouts` with `PENDING`, `PAID` or `FAILED`, which is the shape of Everee's documented **Payment Data API** (`GET /integration/v1/payment-data`). So the two did not meet, and the answer was always "unknown".

**What changed.**
- New client call `getPaymentData(payDate, after)`: `GET /integration/v1/payment-data?pay-date=YYYY-MM-DD&limit=1000[&after=cursor]`, read-only.
- `reconcileItem` still reads the payment history first: it stays the gate (404 until Everee has processed the payment) and supplies the pay date. It then finds the payment by its ID in the Payment Data API (paging through the pay date, at most 20 pages) and gives that payment to the existing parser. Nothing about when a payment counts as paid has changed: every payout PAID, the amount equal to what was sent, the worker the item's worker; PENDING stays pending, FAILED is a returned deposit, anything not understood is unknown.
- New outcomes, none of which pays anything: no pay date in the history answer (unknown, no further call), the payment not listed yet in the payment data (`not_processed`, looked at again later), the payment data unreadable (`unreadable`, nothing changed).

**Database / config / dependencies:** None. **Money impact:** None; no amount is calculated or changed. Completion is still the shared `settlePaidStatements` under the same locks.

**Sandbox evidence (statuses and counts only; no personal data).** For the payment that was approved: the history call answered with the pay date, `grossEarnings`/`netEarnings` of 642.28 and two `deposits`, no statuses. The payment data for that pay date (4 payments) listed it with payment `status` PAID, one `DIRECT_DEPOSIT` payout of 642.28 with status **PENDING** (the ACH was submitted, not settled), and the same worker. So with this fix that payment reads "the payment is PAID but the deposit is not complete yet": correctly not paid, until Everee settles the payout.

**Tested** (`evereePaymentStatus.test.js`, database, rolled back; the fake Everee now answers the history call in its real shape without payouts and has a payment-data call): the existing 18 steps still pass; new: a PAID payment with a PENDING payout is pending and unpaid, the same payment with the payout PAID is paid once (a second check is unchanged), a FAILED payout is a returned deposit, a payment not listed or a payment data error changes nothing, a payment on the second page of its pay date is found, and a history answer without a pay date makes no payment data call. With the old way of reading, 16 tests fail (checked). All Everee tests: 125 of 127 pass; the 2 failures are in `evereeSubmit.test.js`, and they fail the same way on `develop` without this change.

**Not tested.** The payout of the sandbox payment reaching PAID (it was PENDING when read), a real failed or returned payment (Everee has not told us how to trigger one in the sandbox), and the real `payment.deposit-returned` webhook. Jasil asked for the paid round trip before any production activation.

**Risks and follow-ups.** The Payment Data API lists only paid payments, so a payment can sit in "not listed yet" for a while; the scheduled check (every 15 minutes) and the webhook look again. When many payments share a pay date, the lookup pages through them (up to 20,000); a smaller page or a per-worker filter, if Everee offers one, would be lighter. The two failing `evereeSubmit` tests should be looked at separately.

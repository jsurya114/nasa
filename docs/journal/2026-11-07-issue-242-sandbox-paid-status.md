# Sandbox: a PAID payment counts as the bank transfer complete

- Date: 7 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #242 (follow-up to #31); PR: see the pull request for branch `feat/everee-sandbox-paid-status`
- Type and scope: feat, Everee payment status (Backend only). No reserved Excel/pay-upload file is touched.

## What and why

Everee's sandbox sends no money and its bank payouts may stay `PENDING` for ever, so a sandbox payment never reached "paid" in NASA and the driver
never saw "Completed". On the owner's instruction, in the SANDBOX only, a payment whose own status in Everee's Payment Data API is `PAID` now counts as
the bank transfer complete. The scheduled check and the webhook-prompted check mark the item and statement paid, and the driver's transfer list shows
"Completed" without any further change.

Second part, same sandbox-only scope: a worker's Everee payment can hold payables from other sends of the same week (the same pay run sent from another
NASA database to the shared sandbox company), so its total is larger than NASA's item and the amount check refused it. In the sandbox NASA now reads its own
payable (`ownPayableIsPaidInPayment`): it must be `PAID`, inside this very payment, for exactly the amount NASA sent. Then the item is paid for NASA's amount
only. Any problem reading the payable, a different amount or another payment still leaves the item unpaid. Production is unchanged and keeps refusing.

What stays the same:
- Production: only the payouts decide (every payout `PAID`). The new rule is `countsAsLanded(environment, payout)` in `paymentState.js` and is false for
  `production`.
- A returned payout (`FAILED`) is never covered by the new rule. An answer not understood is still "unknown".
- The worker and amount checks, the locks, the frozen amounts and the one-transaction settlement are unchanged.
- No new status, endpoint, setting or screen.

Files: `services/payments/everee/paymentState.js` (reads the payment's own status, adds `countsAsLanded`), `paymentStatus.js` (uses it where it used to
wait on a pending payout), comments in `driverTransfers.js`.

## Database, config, dependencies

None.

## Money impact

None in production. In the sandbox, statements of sandbox batches can now become paid when Everee's payment is `PAID`; no amount changes.

## Tested

- `evereePaymentState.test.js`: the rule (sandbox yes, production no, returned never, unknown never) and the own-payable check (production no, not paid, other
  payment, other amount, no amount all refused).
- `evereePaymentStatus.test.js`: a payment holding two sends is refused until our payable is PAID inside it for our amount, then only our amount is paid.
- `evereePaymentStatus.test.js` (database test, rolled back): the sandbox scenarios that asserted "PAID payment with a pending payout is not paid" now
  assert the new behaviour; a payment whose own status is `PENDING` is still not paid; `evereeDriverTransfers` and `evereeWebhook` pass.

Not tested: a real sandbox payment moving to `PAID` (the sandbox needs an approval or Everee's auto-approval first); the production path in a database
test (covered by the unit test of the rule). On the local copy, `evereeSubmit` and `paymentRecords` fail before and after this change because the copy
holds a real sandbox payment.

## Risks and follow-ups

The payment-level `PAID` means Everee processed the payment, not that the bank cleared it. That is acceptable only because nothing real moves in the
sandbox. Do not copy this rule to production.

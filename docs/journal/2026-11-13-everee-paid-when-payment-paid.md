# Everee: a payment Everee shows as PAID is marked paid in NASA

| Field | Value |
|---|---|
| Date | 2026-11-13 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `fix/everee-paid-when-payment-paid` |
| Type / scope | `fix(payroll)` |
| Files touched | Backend: `services/payments/everee/paymentState.js`, `paymentStatus.js`, `driverTransfers.js` (comments only); tests `evereePaymentState`, `evereePaymentStatus`. Journal entry. |
| Reserved files touched | None |

**What and why.** A driver was paid through Everee (the payment shows PAID in the Everee portal, the money is in her bank account), but NASA kept the row "Submitted" with the note "Everee has the payment; the deposit is not complete yet". In production NASA marked a payment paid only when every bank payout of the payment was PAID, and the payout record can stay PENDING for days after Everee shows the payment as Paid.

- `countsAsLanded` no longer depends on the environment. A payment counts as landed when every payout is PAID, or when Everee says the payment itself is PAID and the payouts are only PENDING (until now the second case counted in the sandbox only).
- Unchanged guards: a FAILED (returned) payout is never covered; in production the amount must be stated and equal what NASA sent, or NASA leaves the row "unknown" / "amount_differs"; the payment must belong to the item's worker; an answer that is not understood is never paid.
- A deposit returned after NASA marked it paid is still flagged for a person by the Everee payment event (`deposit_returned`), as before. Paid history is not rewritten.
- The function lost its first parameter (the environment); its two callers and the comments were updated.

**Database.** None.

**Config and dependencies.** None.

**Money impact.** This changes when a statement is marked paid. No amount, rate or deduction changes, and the same locked, single transaction (`settlePaidStatements`) is used. Before: production waited for every payout to be PAID. After: production also accepts Everee's payment-level PAID. A bank return that arrives after that point is no longer prevented from showing "paid" first; it is flagged afterwards.

**Tested.**
- `evereePaymentState` unit tests: 7 passed, 0 failed.
- `evereePaymentStatus` database tests on a local copy: 24 of 25 subtests passed. The one failing subtest (the scheduled check) fails identically without this change. The local copy needs `EVEREE_ONBOARDING_ENFORCED=false QUICKBOOKS_ONBOARDING_ENFORCED=false` or every batch is blocked by the onboarding gate.
- New production test: payment PENDING is not paid; a FAILED payout is "returned"; another amount is "amount_differs"; PAID with a PENDING payout is paid, once. With the new rule removed, that test and the unit test fail.

**Not tested.** Against real Everee: the field `status` on a payment in the Payment Data API is read as the sandbox answer showed it. If production names it differently, the row stays Submitted (nothing is wrongly paid). Anna Sanchez's real payment has not been run through this.

**Risks and follow-ups.**
- Everee's own PAID is trusted before the bank confirms; an ACH return days later is caught only through the Everee return event.
- The payment event for a paid item (`payment.deposit-returned`) is the safety net; it should be confirmed that production receives it.

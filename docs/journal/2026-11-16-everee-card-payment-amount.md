# Everee: a payment paid to the worker's Everee card is not marked paid

| Field | Value |
|---|---|
| Date | 2026-11-16 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `fix/everee-card-payment-amount` |
| Type / scope | `fix(payroll)` |
| Files touched | Backend: `services/payments/everee/paymentState.js`; tests `evereePaymentState`, `evereePaymentStatus`. Journal entry. |
| Reserved files touched | None |

**What and why.** A driver paid to the Everee card showed Paid in Everee but "Submitted to Everee" in NASA, with the note "Everee paid 0.00 for
this payment but 274.46 was sent". A read-only look at that one production payment (amounts only, no names or IDs) showed Everee's Payment Data
answer with `status: PAID`, an empty `netPayouts` list, `totalNetPay` of `0.00`, and the wages (`totalTaxableWages`) equal to what NASA sent,
with no deductions and no withholdings. A card payment has no bank payout, so Everee states the net pay as zero. Direct-deposit payments
(checked on two others) state `totalNetPay` equal to the wages.

- `readPaidWithoutPayouts` now reads the amount of a PAID payment with an empty payout list as follows: if `totalNetPay` is above zero, that
  stays the amount (unchanged). If it is exactly `0.00` AND the deduction list and the withholding list are both present and empty AND the
  wages and non-taxable pay can be read, the amount is wages plus non-taxable pay. Anything else keeps the stated net pay.
- Unchanged guards: in production the amount must be stated and equal what NASA sent (or the sum of NASA's items in that payment) to the cent,
  the payment must belong to the item's worker, and nothing is marked paid twice (`settlePaidStatements`, one locked transaction).

**Database.** None.

**Config and dependencies.** None.

**Money impact.** This changes when a statement is marked paid, for card payments Everee itself shows as PAID. No amount, rate or deduction
changes. The wages must equal NASA's frozen amount to the cent, so another amount stays unpaid with a note.

**Tested.**
- `evereePaymentState` unit tests: 9 passed, 0 failed. With the change removed, the new test fails.
- `evereePaymentStatus` database tests on a local copy (`PAYROLL_TEST_DB=1 EVEREE_ONBOARDING_ENFORCED=false QUICKBOOKS_ONBOARDING_ENFORCED=false
  QUICKBOOKS_PAYMENTS_ENABLED=false`): 28 passed, 0 failed. With the change removed, the new subtest fails. It covers: other wages
  (`amount_differs`), a deduction listed (`amount_differs`), another worker's payment (`unknown`), and the matching payment paid once.

**Not tested.** Against real Everee after this change (the shape was read from production, but the change itself was not run there).

**Risks and follow-ups.**
- A payment with net pay `0.00`, no deductions and no withholdings, but wages above zero is treated as a card payment. If Everee ever
  reports that shape for a payment that did not reach the worker, NASA would mark it paid when the wages match. Everee shows it PAID, which is the
  same trust the existing rule places in Everee's own PAID status.
- With no bank payout there is no payout status to check, so a return is caught only through Everee's return event (as for #284 and #286).
- After deployment the 15-minute check marks the stuck card-paid rows paid; "Check now" does it at once.

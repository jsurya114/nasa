# Everee: a card payment is marked paid only after its card payout is verified

| Field | Value |
|---|---|
| Date | 2026-11-16 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `fix/everee-card-payment-amount` |
| Type / scope | `fix(payroll)` |
| Files touched | Backend: `services/payments/everee/paymentState.js`, `evereeClient.js`, `paymentStatus.js`; tests `evereePaymentState`, `evereePaymentStatus`. Journal entry. |
| Reserved files touched | None |

**What and why.** A driver paid to the Everee card showed Paid in Everee but "Submitted to Everee" in NASA. Everee's Payment Data answer for such a
payment has `status: PAID`, an empty `netPayouts` list and `totalNetPay` of `0.00`. The first version of this change read the wages as the amount
paid. The review pointed out that this is an inference, not evidence: `totalNetPay` is the sum of the payouts, so zero and an empty list prove
nothing about what was delivered. This version removes that inference and verifies the card payout itself.

- For a payment that is PAID with an empty payout list, NASA now asks Everee's net payouts list for the payment's payouts
  (`GET /integration/v1/net-payouts?payment-id=`). The payment's own total and wages are never used as the amount.
- The payment is settled only when every payout in use (replaced `SUPERSEDED` ones are ignored) belongs to this payment, is a card payout
  (`PAY_CARD`), names one worker (the same worker the payment names, and the item's worker), has a readable amount above zero, and is `PAID`.
  The sum of those amounts must still equal what NASA froze (or the sum of NASA's items in that payment), to the cent.
- Not settled, with a note for a person: no payout listed, a payout of another type, another payment or another worker, an unreadable or zero
  amount, an unknown status, a list longer than one page, a `PENDING` payout (waits and is looked at again), a `RETURNED` payout (flagged as
  returned), a different amount, or an Everee error (nothing changes and it is looked at again).
- This also replaces the amount source of the earlier empty-list rule (#286): that rule took the amount from `totalNetPay`.

**Second review round.**
- The worker is now checked before a payment's state is acted on, so a returned (or pending) payout that belongs to another worker can no longer set this
  item's return flag; it is left as "not understood" with a note.
- In the sandbox, the allowance that accepts a payment holding several sends (our own payable is PAID inside it for the amount sent) no longer applies to a
  card payout: a card total that differs from what NASA sent stays unconfirmed in every environment.
- Both have regression cases in `evereePaymentStatus` (27 pass; the two new assertions fail without the change).

**Database.** None.

**Config and dependencies.** None. One new read-only call to Everee.

**Money impact.** This changes when a statement is marked paid, for payments Everee shows as PAID with no bank payout. No amount, rate or deduction
changes. A payment is settled only on Everee's own payout record and only for the exact frozen amount.

**Tested.**
- `evereePaymentState` unit tests: 9 passed, 0 failed (the payout verification: card type, payment, worker, amount, status, replaced payouts, long list).
- `evereePaymentStatus` database tests on a local copy (`PAYROLL_TEST_DB=1 EVEREE_ONBOARDING_ENFORCED=false QUICKBOOKS_ONBOARDING_ENFORCED=false
  QUICKBOOKS_PAYMENTS_ENABLED=false`): 27 passed, 0 failed. The card subtest covers: no payout, an Everee error, a bank payout, pending, another
  worker, another amount, a payment naming another worker, a payment not PAID, returned, and the matching payout paid once.

**Not tested.** Against real Everee. The request and answer shape come from Everee's published "List net payouts" reference; it was not run against
the production tenant, so it is not confirmed that the endpoint lists the affected hosted payment's payout there. If it does not, nothing is marked
paid: the row stays Submitted with the note that its card payout could not be verified. Check one stuck row after deployment with "Check now".

**Risks and follow-ups.**
- A returned card payout is flagged with the existing "bank returned" note, which says bank; the wording is not specific to cards.
- After deployment the 15-minute check re-reads the stuck card-paid rows; "Check now" does it at once.

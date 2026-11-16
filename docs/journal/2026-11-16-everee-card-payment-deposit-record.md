# Everee: a card payment is verified from the payment's deposit record

| Field | Value |
|---|---|
| Date | 2026-11-16 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `fix/everee-card-payment-deposit-record` |
| Type / scope | `fix(payroll)` |
| Files touched | Backend: `services/payments/everee/paymentState.js`, `paymentStatus.js`; tests `evereePaymentState`, `evereePaymentStatus`. Journal entry. |
| Reserved files touched | None |

**What and why.** After #291 went to production, card-paid drivers (for example the ones that showed Paid in Everee but "Submitted" in NASA) were still not
marked paid. The note said Everee's list had no active payout for the payment. A read-only look at one real production card payment (field names, statuses
and amounts only; no names or IDs were kept) showed:
- Everee's net payouts list is **empty** for the payment, and also for its worker: card payments are not listed there at all.
- The Payment Data entry says `status: PAID`, an empty `netPayouts`, a net pay of 0.00 and wages equal to what NASA sent.
- The payment's own history record (`workers/payment-history/{paymentId}`) states the **deposits** (one deposit of exactly the amount NASA sent) and a
  `netEarnings` equal to it.

So the deposit record is the one place where Everee states what was deposited for a card payment.

- When the payment is PAID with an empty payout list AND Everee's net payouts list for it is completely empty (not even a replaced payout), the payment's
  history record is now read (it was already read, so no extra request). It verifies the payment only when: it is this payment's record; it names one worker
  (the worker the payment names, and later the item's worker); it has at least one deposit; every deposit amount is readable and above zero; and the deposits
  add up to its own `netEarnings`. Their sum is then compared with what NASA froze, to the cent, exactly as before.
- Unchanged: a payout in the net payouts list is never overridden by the history (any listed payout, including a bank payout or a replaced one, goes through
  the payout rules of #291); the payment itself must be PAID; the sandbox own-payable allowance still never applies to a card payment; and the worker is checked
  before anything is recorded.
- Anything missing, unreadable, for another worker or another payment, or not adding up stays Submitted with a note ("its card payment could not be verified (...)").

**Database.** None.

**Config and dependencies.** None. No new request: the history record was already read for the pay date.

**Money impact.** This changes when a card payment is marked paid (only for payments Everee itself shows as PAID with an empty payout list, on Everee's own
deposit record and the exact frozen amount). No amount, rate or deduction changes.

**Tested.**
- `evereePaymentState` unit tests: 11 passed (the deposit record: payment, worker, deposits, sum, split deposits; and when the payout list counts as "empty").
- `evereePaymentStatus` database tests on a local copy (`PAYROLL_TEST_DB=1 EVEREE_ONBOARDING_ENFORCED=false QUICKBOOKS_ONBOARDING_ENFORCED=false
  QUICKBOOKS_PAYMENTS_ENABLED=false`, fake Everee): 29 passed. The new subtest covers: no deposit, another worker, no worker, another payment, deposits not adding up, a
  missing net earnings, a zero deposit, another amount (also with the sandbox allowance), a bank payout or only a replaced payout in the list, a payment not PAID,
  and the matching record paid once (a split across two deposits is summed). It fails without the change in `paymentStatus.js`.

**Not tested.** Marking a real card payment paid in production: the shape was read from one real payment, the change itself was not run there.

**Risks and follow-ups.**
- The deposit record does not say that the destination is an Everee card (`destinationLabel` is free text that was not relied on). The rule is "Everee's list has no
  payout at all, the payment is PAID, and its own record states deposits that equal the net earnings and the amount sent". A reviewer should decide whether that is
  enough, or whether Everee should confirm a more explicit field.
- With no payout record there is no later status to check, so a return of the card deposit is caught only through Everee's return event.
- After deployment the 15-minute check (or "Check now") marks the stuck card-paid rows paid.

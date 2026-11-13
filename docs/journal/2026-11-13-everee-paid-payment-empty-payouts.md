# Everee: a payment shown as PAID with an empty payout list is marked paid

| Field | Value |
|---|---|
| Date | 2026-11-13 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `fix/everee-paid-payment-empty-payouts` |
| Type / scope | `fix(payroll)` |
| Files touched | Backend: `services/payments/everee/paymentState.js`; tests `evereePaymentState`, `evereePaymentStatus`. Journal entry. |
| Reserved files touched | None |

**What and why.** After #284 several drivers were still "Submitted" in NASA while Everee showed them as Paid. The note on each row said "Everee's answer for this payment was not understood". A read-only look at one real production payment (structure only, no names or amounts) showed that Everee's Payment Data API listed the payment with `status: PAID` and an **empty** `netPayouts` list. NASA read an empty payout list as "not understood", so it never marked the row paid.

- `readPayoutState` now treats a payment whose own `status` is PAID and whose `netPayouts` is an empty list like "PAID with a payout still pending": it counts as landed (`countsAsLanded`). The amount is read from the payment's `totalNetPay`.
- Unchanged guards (all still apply to this case): in production the amount must be stated and equal what NASA sent (or the sum of NASA's items in that payment), the payment must belong to the item's worker, and nothing is marked paid twice.
- Still "not understood", never paid: an empty list on a payment that is not PAID, a missing payout list, a payout list that is not a list.

**Database.** None.

**Config and dependencies.** None.

**Money impact.** This changes when a statement is marked paid, for payments Everee itself shows as PAID. No amount, rate or deduction changes. The same locked, single transaction (`settlePaidStatements`) is used, and the amount must match to the cent.

**Tested.**
- `evereePaymentState` unit tests: 8 passed, 0 failed. With the new rule removed, the new test fails.
- `evereePaymentStatus` database tests on a local copy (`EVEREE_ONBOARDING_ENFORCED=false QUICKBOOKS_ONBOARDING_ENFORCED=false`): 25 of 27 passed. The failing subtest (the scheduled check) failed identically before this change (noted in the earlier entry for #284); the new subtest passes: another amount is `amount_differs`, another worker's payment is `unknown`, a payment not PAID is `unknown`, and the matching payment is paid once.
- Backend suite without the database: 416 tests, 319 passed, 0 failed (97 need the database). One earlier run showed 2 failures that did not appear in two reruns; the cause was not found.

**Not tested.** Against real Everee after this change. The amount is read from `totalNetPay`; the real shape of that field in production was not printed. If it cannot be read, the row stays Submitted with the note "did not state the amount" and nothing is wrongly paid.

**Risks and follow-ups.**
- With an empty payout list there is no bank payout status to check, so a bank return days later is caught only through Everee's return event (as for #284).
- After deployment the 15-minute check marks the stuck rows paid; "Check now" does it at once. The three rows whose payable status is PAID and the two PENDING_APPROVAL rows with this note are the ones to look at.
- The 7 `UNPAYABLE_WORKER` rows are a different case (the worker in Everee), not changed here.

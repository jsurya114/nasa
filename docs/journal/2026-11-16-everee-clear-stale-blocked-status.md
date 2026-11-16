# Everee: a stale "worker cannot be paid" error stays on a payment that is now being processed

| Field | Value |
|---|---|
| Date | 2026-11-16 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `fix/everee-clear-stale-blocked-status` |
| Type / scope | `fix(payroll)` |
| Files touched | Backend: `services/payments/everee/paymentStatus.js`; test `evereePaymentStatus`. Journal entry. |
| Reserved files touched | None |

**What and why.** A payment sent while the worker had not finished onboarding got Everee's answer `UNPAYABLE_WORKER`, so NASA marked it
Unconfirmed with the message "it was not paid out". After the worker finished onboarding, Everee created the payment and it showed as
pending there, but NASA kept the red error. The payment ID had arrived through Everee's payment event, and NASA re-reads the payable's
status only while it has no payment ID, so the old blocked status was never cleared.

- `reconcileItem` now re-reads the payable once for an Unconfirmed item that already has a payment ID. If Everee is processing it, the item and
  its statement go back to Submitted and the old error text is cleared. If it is still blocked, nothing changes. If the read fails, nothing changes.
- Nothing is marked paid by this. Only a payment that landed marks a statement paid, with the same amount, worker and single-transaction checks.

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None. No amount, rate or deduction changes, and no statement is marked paid by this change.

**Tested.**
- `evereePaymentStatus` database tests on a local copy (`PAYROLL_TEST_DB=1 EVEREE_ONBOARDING_ENFORCED=false QUICKBOOKS_ONBOARDING_ENFORCED=false
  QUICKBOOKS_PAYMENTS_ENABLED=false`): 28 passed, 0 failed. With the fix removed, the new subtest fails.

**Not tested.** Against real Everee after this change.

**Risks and follow-ups.**
- One extra read of Everee's payable per check for each Unconfirmed item that has a payment ID. These are few.
- After deployment the 15-minute check clears the stale error on the affected row; "Check now" does it at once.

# Driver payments: a "Partly paid" tab, so a run is shown in only one place

| Field | Value |
|---|---|
| Date | 2026-11-16 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `feat/payment-runs-partly-paid-tab` |
| Type / scope | `feat(payroll)` |
| Files touched | Backend: `services/payroll/payRuns/paymentRecords.js`, `controllers/payroll/paymentRecordController.js`; tests `paymentRecords`, `processingPayments`. Frontend: `components/Admin/payRuns/PaymentRuns.jsx` and its test. Journal entry. |
| Reserved files touched | None |

**What and why.** The Driver payments card had two tabs, "Awaiting payment" and "Payment history". A run with some drivers paid and some not
showed in both, with the same card, which confused the super admin. There are now three tabs:

- **Awaiting payment**: no driver of the run is paid yet.
- **Partly paid** (new): at least one driver is paid and at least one is not. The card is the same as before: remaining amount and "Pay to drivers".
- **Payment history**: every run with at least one payment recorded, so the payments already made on a partly paid run show here too. For a partly
  paid run the history card shows only what was paid ("Paid so far", `paid_total`, "X of Y drivers marked paid") and "View payment records".
  It shows no remaining amount and no "Pay to drivers" button, so it does not look like it is waiting for payment.

A run is never in "Awaiting payment" and another tab at once. Drivers whose payment is with Everee (submitted or unconfirmed) are not paid, so a
run with none paid stays in Awaiting payment, as before.

**Review fix: the history dialog is read-only.** "View payment records" on a partly paid run in Payment history used to open the payment workflow
(remaining drivers pre-selected, "Continue with payment"). `RecordPaymentDialog` has a new `readOnly` prop, set when it is opened from Payment history:
it shows the paid and processing drivers with their receipts, says how many drivers are still to pay and where to find them (Partly paid), selects
nobody, and has no checkboxes, no Everee run results, no Pay or Continue buttons, only Done. From Partly paid it still opens the payment workflow.

**Database.** None. The run list query's grouping condition changed; the new `partly` value of `view` is accepted by the route.

**Config and dependencies.** None.

**Money impact.** None. Only which tab lists a run changes. No amount, status or payment record changes.

**Tested.**
- Backend `paymentRecords` and `processingPayments` database tests on a local copy (`PAYROLL_TEST_DB=1 EVEREE_ONBOARDING_ENFORCED=false
  QUICKBOOKS_ONBOARDING_ENFORCED=false QUICKBOOKS_PAYMENTS_ENABLED=false`), run one file at a time: 16 and 6 passed, 0 failed. The new assertions
  (a run with one of two drivers paid is not in `ready`, is in `partly` and in `history` with `paid_total` 40.00; fully paid leaves `partly`) fail with the old query.
- Two database test files run at the same time fail on a clean `develop` too, so the suite must run them one at a time.
- Frontend: full suite 603 passed. `PaymentRuns` test updated for three tabs. After the review fix: the `payRuns` tests (76) pass; the extended test opens the
  history action of a partly paid run, sees the receipt, and finds no checkbox, Continue, Pay or Select buttons; it fails without the fix.

**Not tested.** In a browser against real data.

**Risks and follow-ups.**
- A partly paid run is in two tabs (Partly paid and Payment history) on purpose, but the two cards differ: one is to pay what is left, the other is a record of what was paid.
- A run whose remaining drivers are only "processing" with Everee stays in Partly paid until Everee confirms them.

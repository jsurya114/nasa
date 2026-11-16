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

**What and why.** The Driver payments card on the dashboard had two tabs, "Awaiting payment" and "Payment history". A run with some drivers
paid and some not showed in both, which confused the super admin. There are now three tabs and a run is in exactly one:

- **Awaiting payment**: no driver of the run is paid yet.
- **Partly paid** (new): at least one driver is paid and at least one is not.
- **Payment history**: every driver of the run is paid.

The card itself is unchanged. A partly paid run keeps its "Pay to drivers" button, its remaining amount and its processing line, and its
payment records are still shown in the same dialog. Drivers whose payment is with Everee (submitted or unconfirmed) are not paid, so a run
whose paid drivers are none stays in Awaiting payment, as before.

**Database.** None. The run list query's grouping condition changed; the new `partly` value of `view` is accepted by the route.

**Config and dependencies.** None.

**Money impact.** None. Only which tab lists a run changes. No amount, status or payment record changes.

**Tested.**
- Backend `paymentRecords` and `processingPayments` database tests on a local copy (`PAYROLL_TEST_DB=1 EVEREE_ONBOARDING_ENFORCED=false
  QUICKBOOKS_ONBOARDING_ENFORCED=false QUICKBOOKS_PAYMENTS_ENABLED=false`), run one file at a time: 16 and 6 passed, 0 failed. The new assertions
  (a run with one of two drivers paid is in `partly` only; fully paid is in `history` only) fail with the old query.
- Two database test files run at the same time fail on a clean `develop` too, so the suite must run them one at a time.
- Frontend: full suite 603 passed. `PaymentRuns` test updated for three tabs.

**Not tested.** In a browser against real data.

**Risks and follow-ups.**
- A run that used to appear in Payment history because one driver was paid now appears under Partly paid until every driver is paid.
- The older `partly` cards of a run whose last unpaid drivers are only "processing" stay in Partly paid until Everee confirms them.

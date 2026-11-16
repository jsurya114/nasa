# Pay to drivers: "Force mark as paid" for a driver the system cannot confirm

| Field | Value |
|---|---|
| Date | 2026-11-16 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `feat/force-mark-driver-paid` |
| Type / scope | `feat(payroll)` |
| Files touched | Backend: `services/payroll/payRuns/paymentRecords.js`, `controllers/payroll/paymentRecordController.js`, `routes/payrollRoutes.js`, `services/payments/everee/batchSubmit.js`, `paymentStatus.js`; tests `forcePayment` (new), `evereeSubmit`. Frontend: `ForcePaymentPanel.jsx` (new) and its test, `RecordPaymentDialog.jsx`, `everee/EvereeBatchResults.jsx`, `ProviderPaymentLine.jsx`, `evereeLabels.js`, `PaymentRuns.test.jsx`. Journal entry. |
| Reserved files touched | None |

**What and why.** Some drivers must be shown as paid whatever their payment status is: a payment that is processing, unconfirmed (for example Everee reports the
worker as unpayable), failed, held for review or onboarding, or one made outside NASA. Until now these drivers could not be marked paid at all (the dialog
refuses "a selected payment is processing, unconfirmed or needs review"). A super admin can now **force mark a driver as paid** from Pay to drivers.

- Every driver that is not paid shows a "Force mark as paid" link in the dialog (not in the read-only payment history). It opens a small panel with the date
  paid, a written reason (10 to 180 characters), and a confirmation that says the driver is paid the amount and that it cannot be undone here.
- `POST /admin/payroll/payments/runs/:runId/force-paid` (super admin route). The request names the statements, the date, the reason and `confirmed: true`.
  The method is always `other`; the reason is kept on the receipt and the statement as `Forced: <reason>`, so the receipt shows who did it, when, and why.
- The role is checked in the database inside the service (an active super admin now), not from the token.
- It uses the same locked transaction as manual recording (run, city, statements) and the one shared `settlePaidStatements`, so frozen amounts, deductions
  and debt are not touched. One request ID makes a repeated request a replay (the same details) or a refusal (different details). A statement that is already
  paid is left alone.
- What a forced mark **skips**: a payment in progress (submitted or unconfirmed), a failed attempt, the driver type rule, the Everee onboarding hold, the
  QuickBooks rule for Desi drivers, and source earnings that changed or were already marked paid (those rows are left exactly as they were; the statement is
  still marked paid).
- What it **never** skips: the run must be approved (finalized), the statement must belong to the run, and a statement below zero is refused.
- Nothing is sent to Everee or QuickBooks. An Everee item that was waiting is closed: it is shown as "Marked paid by an admin", is not counted as waiting,
  failed or retried, and the 15-minute check no longer asks Everee about it (the item itself is not rewritten as paid, so nothing says Everee confirmed it).
  The two API answers that show Everee items get one extra field, `markedPaidByAdmin: true`, only for such an item; nothing changes for any other item.

**Database.** None. `pay_run_payment_records.method` already allows `other`, and `pay_run_payment_items.driver_type` is nullable.

**Config and dependencies.** None.

**Money impact.** It changes no amount: the statement's frozen net is what is recorded as paid. It changes what NASA says is paid, by a person's decision.
No payment is made or reversed anywhere.

**Tested.**
- Backend on a local copy (`PAYROLL_TEST_DB=1 EVEREE_ONBOARDING_ENFORCED=false QUICKBOOKS_ONBOARDING_ENFORCED=false QUICKBOOKS_PAYMENTS_ENABLED=false`, one file at a
  time): `forcePayment` 9 passed (an admin, a disabled super admin and a stale token are refused; the normal way still refuses a processing, failed or untyped driver; a
  forced mark records the receipt, the statement and the source rows; a repeat is a replay, other details a 409, a paid statement is untouched; changed source rows are
  not touched; another run's statement and an unapproved run are refused; a waiting Everee item is closed and not asked about again). `evereePaymentStatus` 29,
  `paymentRecords` 16, `processingPayments` 6 passed. `evereeSubmit` 25 passed and 1 failed (test 2): the same single failure as on a clean `develop`, caused by one
  leftover committed attempt row in this local test database; it is not related to this change.
- `evereeSubmit` test 9 was updated: a failed Everee item whose statement was paid by hand is now closed (counted as marked by an admin, no longer as failed).
- Frontend: whole suite 627 passed (the panel on its own, and in the dialog: every unpaid driver, including a processing one, has the option and it posts the
  right request; the history never offers it). Backend without a database: 339 passed.

**Not tested.** In a browser against real data, and with real Everee or QuickBooks.

**Risks and follow-ups.**
- A forced mark is a person's word. If an Everee payment is still processing and later goes through as well, the driver is paid twice (once outside, once by Everee);
  if it later fails, NASA still says paid. The panel says so before the confirmation. Check Everee before forcing a payment that is processing.
- For a Desi driver a forced mark does not reach QuickBooks, so no bill or bill payment is recorded there for the 1099 reports: record it in QuickBooks by hand.
- It cannot be undone from this screen (payment history is permanent by design); a mistake needs a separate correction.
- It is for the super admin only; ordinary admins cannot reach the route.

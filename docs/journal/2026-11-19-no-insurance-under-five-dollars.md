# No insurance for a driver whose pay in a pay run is under $5

| Field | Value |
|---|---|
| Date | 2026-11-19 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `fix/no-insurance-under-five-dollars` |
| Type / scope | `fix(payroll)` |
| Files touched | Backend: `services/payroll/payRuns/payCalculator.js`, `services/payroll/payRuns/paymentRecords.js`, `services/payroll/ledger/driverPayable.js`; tests `payCalculator`, `payRunStore`, `payBatchReview`, `evereeBatchPreview` (updated), `insuranceMinimum` (new). Journal entry. |
| Reserved files touched | None of the Excel, dashboard or upload files. The existing pay files above are Jasil's: he reviews this pull request. |

**What and why.** Insurance is $1.92 per working day, set on each pay row by the weekly upload. A driver who worked one day and earned $0.25 therefore had a
statement of $0.25 − $1.92 = −$1.67. A statement below zero cannot be approved ("a statement is below zero"), so the whole pay run could not be drafted
through. The owner's rule (19 Nov 2026): **no insurance for a driver whose pay in the pay run is under $5.**

- **The rule.** The driver's pay for the run is the sum of their pay rows (not reimbursements). Under $5.00 (`MIN_PAY_FOR_INSURANCE_CENTS = 500`), no insurance is
  taken for that run: no insurance lines, `insurance` is 0.00, and the net is the pay. Exactly $5.00 or more: every day's insurance is taken as before. The
  statement gets a note (`insurance_waived`: "pay under $5.00 for this run, so no insurance ($1.92) was taken"), shown with the other notes and not blocking.
- **Where.** In the pay calculator, when a run is drafted, so it applies to every driver in every city. The upload is not changed: the source rows still carry
  $1.92 per day, which stays what the dashboard and the driver's own screens show.
- **Paying such a statement.** The check "did the source rows change since the statement was frozen?" compared each row's insurance with the frozen insurance. A
  waived statement would have failed it ("earnings changed") and could not be paid. The check now knows a waived statement (insurance 0.00 and pay under $5.00 on the
  statement itself), so an older statement that did take insurance is judged exactly as before.
- **The Payroll page.** The amount owed that decides whether an advance or penalty needs a repayment arrangement uses the same rule.

**Database.** None. **Config and dependencies.** None.

**Money impact.** A driver with under $5.00 of pay in a run no longer loses insurance in that run. The example that prompted it: pay $0.25, insurance $1.92: before net
−$1.67 (run could not be approved), after net $0.25. Nothing changes for a driver with $5.00 or more of pay. Statements already frozen are not changed (history is never
rewritten); the rule applies when a run is drafted, so an existing draft needs to be discarded and drafted again. The insurance that was not taken is not charged
later.

**Tested.**
- Backend on a local copy (`PAYROLL_TEST_DB=1 EVEREE_ONBOARDING_ENFORCED=false QUICKBOOKS_ONBOARDING_ENFORCED=false QUICKBOOKS_PAYMENTS_ENABLED=false`, one file at a time):
  `payCalculator` 20 passed (pay under $5 takes no insurance and says why; $4.98 waived, exactly $5.00 charged on every day; no pay rows or no insurance gives no note; a
  negative statement is still flagged when pay is $5 or more). New `insuranceMinimum` 5 passed (a draft with a $0.25 driver and a $50.00 driver: $0.25 nets $0.25 with the
  note and no insurance line, the other is unchanged; the run is approved and both drivers are paid by hand; the Payroll page amount; the changed-earnings check). Its
  tests fail on the old code. `payRunReview` 15, `paymentRecords` 16, `forcePayment` 12, `evereePaymentStatus` 29, `ledger*` 27, `statementStore` 11, `quickbooksPayments` 11 passed.
- Four older tests assumed a driver with $1.00 or $1.92 of pay goes below zero; they now use $5.00 of pay with more insurance, which still does (`payRunStore`,
  `payBatchReview`, `evereeBatchPreview`).
- Same failures as on a clean `develop` (leftover rows in my local test database): `payRunStore` test 1, `evereeSubmit` test 2, `revenueDefinition` 2, `statementEconomics` 1.

**Not tested.** A real pay run on production data, and a browser run.

**Risks and follow-ups.**
- The rule does not make every statement non-negative: a driver with $5.00 to $9.59 over several days (for example five days of $1.50) still has more insurance than pay and
  is still flagged and blocked. A cap (never take more insurance than the pay) would remove that; not done here.
- The dashboard, the driver's screens and the company revenue reports still count $1.92 per day for these drivers, because they read the source rows, not the statement.
  They show more insurance withheld than was actually taken for drivers under $5.
- The minimum is judged on one run's period. A week split over two runs is judged on each run.

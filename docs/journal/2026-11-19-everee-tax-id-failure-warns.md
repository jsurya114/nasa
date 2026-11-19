# A failed tax ID check in Everee warns instead of holding the payment

| Field | Value |
|---|---|
| Date | 2026-11-19 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `fix/everee-tax-id-failure-warns` |
| Type / scope | `fix(payroll)` |
| Files touched | Backend: `services/payments/everee/workerRules.js`, `batchPreview.js`, `batchSubmit.js` (one argument), `onboardingReadiness.js`; `.env.example`; tests `evereeWorkerRules`, `evereeDriverOnboardingRules`, `evereeOnboardingReadiness`, `evereeWorkers`, `evereeBatchPreview` (updated and extended). Journal entry. |
| Reserved files touched | None. Pay amounts, Excel and dashboard files are not changed. |

**What and why.** On the Thursday payout, 6 drivers of one pay run showed "cannot be paid yet: the worker's tax ID check failed in Everee", although the client had paid the same
drivers the week before. Since 4 November (PR #201) NASA has held any worker whose stored `tin_status` is `VERIFICATION_FAILED`. That status is copied from Everee only when Everee
sends a worker event or someone presses Refresh, so a failure that Everee showed for a while reached NASA's table late (19 drivers had it on 19 Nov, last updated on 13, 16, 17 and
19 Nov), and the rule then held payments that Everee itself had let through. The owner decided that these drivers must be payable.

- **New default.** A worker whose tax ID check failed is **no longer held**. The pay run preview lists them with a warning that does not stop the payment ("the worker's tax ID
  check failed in Everee; the payment is still sent, and Everee decides how it handles it. Ask Everee to fix the check"), shown under the driver in "Read before paying", and
  they are counted in "drivers with warnings". Everee still decides: if it refuses the payable, the item fails with Everee's own message, as for any other refusal.
- **Still held, always:** a worker who has not finished onboarding, a worker who left, a driver not linked to an Everee worker, a statement of $0.00, and a statement already sent.
- **Switch to the old behaviour.** `EVEREE_BLOCK_ON_TAX_ID_FAILURE=true` in the server's `.env` (then `pm2 restart nasa-backend`) holds failed-tax-ID workers again. Anything else, or
  unset, means the new default.
- **Where.** One rule, `readyToPay` in `workerRules.js`, is read by the pay run preview, the retry of a failed payment, the driver's payment setup views and the payment setup
  overview (its `paymentReady` column), so they all agree.

**Database.** None. **Config.** One optional variable, `EVEREE_BLOCK_ON_TAX_ID_FAILURE` (documented in `.env.example`). **Dependencies.** None.

**Money impact.** No amount changes. It lets payments for these workers be sent to Everee that were held before. Whether Everee pays a worker whose tax ID check failed is Everee's decision.

**Tested.** On a local copy of the database (`PAYROLL_TEST_DB=1 EVEREE_ONBOARDING_ENFORCED=false QUICKBOOKS_ONBOARDING_ENFORCED=false QUICKBOOKS_PAYMENTS_ENABLED=false`, one file at a time):
`evereeWorkerRules` 11, `evereeDriverOnboardingRules` 12, `evereeOnboardingReadiness` 6, `evereeWorkers` 14, `evereeBatchPreview` 11 (new: a failed tax ID is an eligible driver with a `tax_id_check_failed`
warning by default and blocked with the switch on; incomplete onboarding is held in both modes), `evereeBatchPreviewRules` 3, `evereePaymentStatus` 29, `forcePayment` 12 passed. `evereeSubmit` 25 passed and
1 failed (test 2), the same failure as on a clean `develop` (a leftover row in my local test database). Backend without a database: 345 passed. Four older tests asserted the old
behaviour and were updated.

**Not tested.** A real payment to Everee for a worker with a failed tax ID (what Everee answers), a browser run, and whether the client's accountant needs anything for these workers.

**Risks and follow-ups.**
- A failed tax ID match can matter for tax reporting (for example withholding on those payments). That is for the client's accountant and Everee; NASA only warns.
- The 19 workers should still be fixed in Everee, and NASA's stored status refreshed (the Refresh button on the payment setup screen) after Everee corrects it.
- A later improvement: refresh the stored tax status automatically when a pay run is previewed, so it never lags Everee.

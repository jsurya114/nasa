# Everee onboarding gate: no work and no new payment for an incomplete Local driver (issue #242, PR B)

- **Date:** 2026-11-07
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #242 / see the pull request for this branch. **PR B of four.** It is built on PR A (#243) and contains its commits until A merges.
- **Branch:** `feat/everee-onboarding-gate`
- **Type and scope:** feat(payroll), backend only
- **Files touched:** new `Backend/services/payments/everee/onboardingGate.js`, tests `evereeOnboardingGate.test.js`; changed `payBatchReview.js`, `paymentRecords.js`, `batchSubmit.js` (payment paths); `journeyController.js`, `adminJourneyController.js`, `driveravailabilityController.js`, `adminavailabilityController.js` (work paths); `paymentRecordController.js`, `evereeBatchController.js`, `evereePaymentController.js` (they now pass the stable `code` through); tests `paymentRecords.test.js`, `evereeSubmit.test.js` (one new case each); `Backend/.env.example`. **The payment flow is Jasil's area and he asked for this gate in the handoff; no reserved Excel/dashboard file is edited** (see "Legacy mark-paid" below).

**The rule (owner decision, confirmed by Jasil).** A LOCAL driver whose Everee onboarding is not verified complete is blocked from **work and from all new payments, Cash in Hand included**. DESI keeps the approved cash-only flow. A driver with no type is not touched by this gate (the existing "no type" rule still applies). Drivers cannot change their own type.

**"Verified complete"** is exactly what the driver's status shows (PR A): a live link in the configured environment **and tenant** whose `onboarding_complete` is true as read from Everee. A link with no tenant (made before tenants were recorded), for another tenant, incomplete or unlinked does not count. Nothing else is restricted: a failed tax ID, for example, stays an Everee-readiness matter, not a new work rule.

**Staged behind configuration.** Enforced only when **both** `EVEREE_DRIVER_ONBOARDING_ENABLED` and the new `EVEREE_ONBOARDING_ENFORCED` are exactly `true`. Off, nothing here runs a query, so the app behaves as before and works on a database that has not run PR A's migration. On, it **fails closed**: if Everee is not set up no Local driver can be verified, so all are held. No silent bypass, no Desi or cash fallback.

**What is gated (all on the server, not only in the navigation).**
- **Work:** the driver's own journey save; an admin creating or changing a journey (the target driver); a driver or an admin turning an availability day **on** (turning days off is allowed). Deleting a journey is not gated.
- **Payments:** the shared batch review (so the screens, the Everee preview, submit and retry all see a blocking `onboarding_required` reason per driver); **Cash in Hand recording**, which refuses the **whole** selection when any selected driver is held (never a partial cash payment of a mixed selection), under share locks on the drivers and their live links so a classification or link change cannot slip in between the check and the write; **Everee submit** (the whole batch is refused) and **Everee retry** (a held driver is not sent; the payment stays failed with the reason on it).
- The stable reason is `onboarding_required` (HTTP 409 with `code`). The pay-run screens already show a blocker's message; no screen changes in this PR.

**What is deliberately not gated.** Excel/weekly imports and the delivery evidence in them; earned balances, approved statements, old receipts; `payment status` settlement and webhooks (transfers already sent keep reconciling); read-only history; the driver's onboarding routes, help, logout, agreement, password and language.

**Legacy mark-paid.** The only older "mark paid" route, `payDriver`, already answers `409` for everyone ("approve a pay run, then record payment"), so there is nothing to gate and the reserved dashboard files are untouched. The query behind it (`updateDriverPaymentStatus`) has no caller; a test asserts the route stays a refusal so a revived path would fail review.

**Before enforcement is switched on (a checklist for the owners, not done by this PR).**
1. Classify every driver on the Drivers page; run PR A's probe against the sandbox.
2. Existing links have no tenant. For the **sandbox only**, after review: `UPDATE everee_workers SET tenant_id = '3578' WHERE environment = 'sandbox' AND tenant_id IS NULL;`. Never for production; production links are verified one by one.
3. Dry-run the counts: how many active Local drivers are held (no live verified link), which have outstanding payouts or open routes, and arrange a safe admin handover before the hard gate.
4. Production enablement needs the owners' explicit approval.

- **Database:** None in this PR (it uses PR A's tables). **Config:** new `EVEREE_ONBOARDING_ENFORCED` (in `.env.example`; off by default). **Dependencies:** none. **Money impact:** None while off. While on, a held driver's pay stays unpaid and approved; amounts, deductions and frozen statements are not touched.

**Tested.** Without a database: the switches, "off means no query", the availability rule, that every work and payment path calls the gate before it writes, that imports and delete are not gated, that the legacy route stays a refusal. With a disposable database copy: the held-driver matrix (no link, incomplete, no tenant, another tenant, unlinked, Desi, no type), fail-closed, whole-set refusal, effects at once; the pay-run review blocker and **cash recording** (mixed and single selection refused with nothing written, the verified driver alone paid, a Desi driver not held); **Everee preview/submit/retry** (reason per driver, nothing reserved, retry leaves the payment failed with the reason, and goes out once verified). Existing review, preview, status, worker and onboarding suites pass; the whole backend suite without a database passes (200 passed, 63 skipped). Two existing database tests (a confirmed Everee batch; the scheduled status check) fail on a copy holding the author's real sandbox payment, as they did before.

**Not tested.** A real browser or phone; screens (PR C). The work controllers are covered by an order-of-calls check, not by driving real requests. Two admins racing a classification change against a payment on real connections (the share locks are exercised, not the race).

**Risks and follow-ups.** With the gate on, every Local driver is held until their link is verified, so the checklist above matters. PR C adds the driver screens that tell a held driver why; PR D the history, statements and the admin list of who is held.

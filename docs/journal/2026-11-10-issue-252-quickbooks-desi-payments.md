# QuickBooks for Desi (1099) drivers: connection, vendor links, payment records, driver onboarding

- Date: 10 November 2026 (written 9 November for the review of PR #266)
- Author: Jasil with Claude Code (the feature, parts 1 to 4); review fix and this entry by Jayasoorya with Claude Code
- Issue: #252 (payroll work); PR: #266, branch `feat/quickbooks-desi-payments`
- Type and scope: feat(payroll), backend, database, frontend
- Files touched: all new QuickBooks files under `Backend/services/payments/quickbooks/`, two controllers, `payrollRoutes.js`, `driverRoutes.js`, two migrations with rollbacks, the Pay runs and driver portal screens, and a runbook (`docs/QUICKBOOKS_DESI.md`). Changed existing files: `driverPaymentRules.js`, `paymentRecords.js` (the pay run review and the cash recording gate) and `onboardingGate.js` (Everee's work hold now also holds a Desi driver when QuickBooks onboarding is enforced; its message now says "Payment setup is not complete", for Everee and QuickBooks). None of the reserved Excel and pay-calculation files is touched.

## What and why

Desi drivers are 1099 contractors who are paid cash in hand, and the client files their 1099s from QuickBooks Online. QuickBooks is only the record: it never pays anyone and never decides whether a driver was paid.

1. **Connection (part 1):** a super admin connects the company to QuickBooks with the Intuit sign-in. The tokens are stored AES-256-GCM encrypted (`QUICKBOOKS_TOKEN_KEY`), a refresh happens under a row lock, and the sign-in uses a single-use state tied to the admin.
2. **Vendor links (part 2):** an existing Desi driver is linked to the one QuickBooks vendor whose email exactly matches theirs. No match, several matches, or a vendor linked to another driver never link. A driver's tax ID is never stored.
3. **Payment records (part 3):** confirming a finalized run's Desi payments records the cash payment first, exactly like any Cash in Hand payment, and then records a bill and a bill payment per driver in QuickBooks. Each attempt is logged before it is sent; a bill is found by its number before it is created, so a retry never makes a second one. A QuickBooks problem never changes whether the driver was paid; a failed or unconfirmed item is retried from its batch.
4. **Driver onboarding (part 4):** a new Desi driver sets up their QuickBooks vendor in the driver portal. The tax ID goes to QuickBooks once and is not stored, logged or returned. A driver already in QuickBooks goes to an admin for review instead of getting a second vendor. An optional hold keeps an unlinked Desi driver from working or being paid.

Everything is off by default behind separate switches.

## Review fix (Jayasoorya, with Claude Code)

The QuickBooks sign-in sends the admin's browser back to `GET /admin/payroll/quickbooks/callback` as a plain page visit, which carries no `Authorization` header. The route sat behind the payroll router's sign-in check, so the callback always answered "UNAUTHORIZED" and a connection could never finish. The tests called the service directly and did not see it.

- The callback is now registered before the sign-in check; every other QuickBooks route still needs the sign-in and the super admin role.
- With no signed-in admin, `finishConnect` takes the admin from the single-use state made when the connection was started, and checks in the database that this admin is still an active super admin before any token is stored. A made-up, used or expired state, a switched-off QuickBooks, or a demoted admin stores nothing.
- `payrollRoutesAccess.test.js`, which lists the routes open before the guard, now expects exactly two: the Dashboard summary and this callback.
- `.env.example` now lists the three later switches (`QUICKBOOKS_PAYMENTS_ENABLED`, `QUICKBOOKS_DRIVER_ONBOARDING_ENABLED`, `QUICKBOOKS_ONBOARDING_ENFORCED`), which the runbook already described.

## Database

New, additive, safe to run twice, each with a rollback. Back up first and run on a copy first.

- `Backend/migrations/2026-11-10-quickbooks-connection.sql` (rollback: `.rollback.sql`): `quickbooks_connection`, `quickbooks_connect_state`, `quickbooks_vendors`.
- `Backend/migrations/2026-11-10-quickbooks-payments.sql` (rollback: `.rollback.sql`): `quickbooks_settings`, `quickbooks_payment_batches`, `quickbooks_payment_items` (one item per pay statement, ever), `quickbooks_payment_attempts`.

I applied both, and applied the first one again, on a scratch copy; both ran cleanly.

## Config and dependencies

New backend variables (names only, never values): `QUICKBOOKS_ENABLED`, `QUICKBOOKS_ENVIRONMENT`, `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_REDIRECT_URI` (must be `https://<backend host>/admin/payroll/quickbooks/callback` and registered at Intuit), `QUICKBOOKS_TOKEN_KEY` (64 hex characters), `QUICKBOOKS_PRODUCTION_APPROVED`, `QUICKBOOKS_PAYMENTS_ENABLED`, `QUICKBOOKS_DRIVER_ONBOARDING_ENABLED`, `QUICKBOOKS_ONBOARDING_ENFORCED`. No new package.

## Money impact

None while the switches are off (the default). With payments on, a Desi driver's payment is recorded as a Cash in Hand payment through the existing function, in the same transaction as the QuickBooks batch, and the amount is always the statement's frozen net; QuickBooks bills and payments only mirror it. With payments on, the plain Cash in Hand route refuses a Desi driver so the QuickBooks record cannot be skipped.

## Tested

- Backend CI-style run: 289 pass, 0 fail (78 skipped, database tests). The four QuickBooks test files with a database on the scratch copy: 39 pass, 0 fail.
- Frontend: 61 files, 528 tests pass; build ok.
- New for the fix: the sign-in return with no admin (accepted for an active owner, refused for a demoted one, a used or unknown state, switched off), the callback handler, and the route-list access test.
- Not tested: a real QuickBooks sandbox (needs the owner's Intuit developer app keys), a real browser or phone, and a real Intuit redirect to a hosted backend.

## Risks and follow-ups

- The connection cannot be tried for real until the owner supplies the Intuit app keys and registers the redirect address; do that in the sandbox before production.
- The callback is intentionally reachable without a login header. It is safe only because the service accepts nothing but a single-use, ten-minute state made by a signed-in super admin; keep that check if the code changes.
- Because the callback cannot carry a login header, the state is no longer tied to the admin's browser session, only to the admin who started it. A forged callback needs a valid state, which only a signed-in super admin can create and only that admin's browser ever receives (256 random bits, single use, ten minutes), so it is not exploitable without already being that admin. If the owners want it tighter, a follow-up can bind the state to a cookie nonce set when the connection starts, and confirm the company ID with a CompanyInfo call after the code exchange. That would change the connect flow, so it is not part of this fix.
- Lookup, link and unlink check that QuickBooks is configured but not that `QUICKBOOKS_ENABLED` is on, and the super admin check on those routes uses the role in the token. Both are minor and left as they are.
- Turn `QUICKBOOKS_ONBOARDING_ENFORCED` on only after every existing Desi driver is linked, or they are held.

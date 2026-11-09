# Reset company prices to 0 for a weekly city, on demand

- Date: 9 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR: see the pull request for branch `feat/reset-weekly-company-prices`
- Type and scope: feat(routes), backend and frontend
- Files touched: `routeController.js`, `adminRoutes.js`, `companyRates.js`, `routes-form.jsx`, new `ResetCompanyPrices.jsx`, and tests. None is reserved (routes are Jayasoorya's zone).

## What and why

Weekly GOFO routes should carry no company price, because company revenue comes from the carrier statement. The owner asked for a button to put the prices back to 0 whenever needed, instead of editing routes or running SQL.

- **Route:** `POST /admin/routes/reset-company-prices` with `{ job }`. Owner only (`superAdminAuth`, which checks the token role and the account in the database).
- **What it does:** sets `company_route_price` and `company_doublestop_price` to 0 on every route of that city, only where one is not 0. Only the two company columns change; driver prices, route names, codes and status are untouched.
- **Refused:** a daily city (its revenue is the stored price) with 400, an unknown city with 404, a missing, non-text or over-long city name with 400.
- **Screen:** on the Routes page an owner always sees "Reset company prices to 0" under the filter row. It is disabled, with a hint, until one weekly city is chosen in the city filter (under All Cities or a daily city it stays disabled); then it opens a two-step confirmation, and a message saying how many routes changed (or that they were already 0). City admins never see the button, and the server refuses them anyway.
- Each reset is logged with the city, the number of routes and the admin's id.

## Database

None. No schema change. The reset is an `UPDATE routes SET company_route_price = 0, company_doublestop_price = 0 WHERE job = $1 AND (either is not 0)`, parameterised.

## Config and dependencies

None.

## Money impact

Pay is not affected: driver pay uses driver prices. Records already saved keep the company figure they have (a weekly route with 0/0 company prices keeps the existing figure on recalculation, and new records get no company figure; revenue comes from the statement). Before: 3 Lafayette routes at 2.50 / 0.50 company prices (made-up values in a rolled-back test); after: 0 / 0, driver price 1.60 unchanged. On the owner's local copy all 17 weekly routes were already 0, so nothing changes there.

## Tested

- `companyRates.test.js` (no database): the reset zeroes only the two company columns, with the city as a parameter; a daily or unknown city writes nothing.
- `resetCompanyPricesController.test.js` (no database): bad or missing city is a 400; the route is wired behind `superAdminAuth`.
- Real local database, one rolled-back transaction: weekly reset, daily refused, unknown refused, driver prices unchanged.
- `ResetCompanyPrices.test.jsx`: nothing is sent until confirmed, Cancel goes back, one request with the chosen city, the count message, the already-0 message, the server's words on a refusal.
- Frontend: 58 files, 510 tests pass; build ok. Backend CI-style run: 260 pass, 0 fail (75 skipped, database tests).
- Not tested: a real browser; the Routes page showing the button only to an owner (small condition, not covered by a test); a second owner clicking at the same moment (the update is idempotent).

## Risks and follow-ups

- Resetting a city whose new weekly records would otherwise be estimated from company prices means those records get no company figure until a statement is published. That is the intended weekly behaviour.
- The reset has no undo; to bring prices back, edit the routes again. A history of resets is only in the server log.

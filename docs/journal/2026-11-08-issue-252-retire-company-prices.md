# Retire the two company price fields for weekly GOFO cities with a verified statement (stage 3b)

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; branch `feat/gofo-retire-company-prices` (stacked on `feat/gofo-reporting`, PR #257, on #256, #255, #254, #253)
- Type and scope: feat(routes). **Reserved files edited at Jasil's request: `Backend/services/admin/weeklyExcelQueries.js` (the company earnings expression of the weekly add) and
  `Backend/services/admin/dashboardQueries.js` (the same expression in Calculate Payment).** Jasil, please review those hunks. Also `routeController.js`, `jobQueries.js`, the route form.

## What and why

For a weekly GOFO city the carrier's statement is the revenue, so the company route price and company double-stop price are no longer needed there. Daily SpeedX keeps them.

- **Retired only once verified.** A weekly city "retires" the fields when it has at least one published carrier statement (`companyRatesRetired`, `services/finance/companyRates.js`). Until
  then its routes behave exactly as before, so nothing is switched off before the statement process works for that city.
- **Server side:** creating or updating a route in a retired city stores 0 for both company prices whatever is sent. The jobs list now carries `has_verified_statements`, so the screen knows.
- **Screen:** the route form hides the two company inputs for a retired city and says why; the route table shows "Carrier statement" in the company price column. A DAILY city is untouched.
- **No false estimates.** The company earnings formula is now written once (`companyEarningsSql`) and used by the weekly add and Calculate Payment. For a weekly route with no company rate
  (both company prices 0) a NEW record gets no company figure (nothing is estimated, so reports show it as missing until the statement arrives), and recalculating an OLD record keeps the
  figure it already has, so old estimated history is not wiped. For every other route the formula is exactly the same as before.

## Database, config, dependencies

None.

## Money impact

Routes with company prices, and every daily route: identical amounts (the formula is the same, only written in one place). New weekly records on a route with no company rate get a null
company figure instead of a negative one (0 - driver price). Driver earnings and pay are unaffected.

## Tested

- `tests/companyRates.test.js`: the SQL text; with a database (`PAYROLL_TEST_DB=1`, rolled back): the formula gives null for a weekly no-rate route, 7.50 for a rated weekly route and -7.50 for a daily route
  with 0 company prices (SpeedX keeps its formula); Calculate Payment keeps an existing figure for the no-rate route and recalculates the others; a city is retired only after a published statement,
  not before, never for daily, and not after the statement is voided.
- `routeCompanyRates.test.js` (frontend, 3 tests): which fields are shown, and what the table says.
- Whole backend suite with the database tests on a copy of the local database: 598 tests, 547 pass, 10 fail. The same 10 fail identically on a clean `develop` checkout with the database tests on
  (they depend on real local sandbox payment data), so they are not caused by this change. Frontend suite: 467 pass.

Not tested: creating and editing a route through the screen and `routeController` against a database (the controller change is a three-line rule on top of the tested helper); the weekly add end to end
for a no-rate route (its SQL is the tested expression).

## Risks and follow-ups

Editing a route in a retired city zeroes its company prices on purpose. Reports label weeks without a statement as estimated; a new route in a retired city has no estimate until its statement arrives.

# Routes page shows what the carrier paid per delivery for weekly routes

- Date: 9 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR: see the pull request for branch `feat/route-statement-price`
- Type and scope: feat(routes), backend and frontend
- Files touched: `routeController.js` (only `fetchPaginatedRoutes`), new `routeStatementPrices.js`, `routeCompanyRates.js`, tests. None is reserved.

## What and why

The owner wants the Company Price column on the Routes page to follow the weekly Excel uploaded under File Upload, with no separate statement page. The weekly workbook is also the carrier statement (PR #262), so once its revenue is published the Routes page now shows, for each weekly GOFO route, what the carrier paid per delivery in the city's latest published statement, for example "Carrier statement: $1.63 per delivery · Week 43-2026". It changes by itself when a newer week is published.

- **Display only.** The route's stored company price is not written; it stays 0 for weekly routes, so pay, estimates and the "no company rate" rule are unchanged. A non-zero stored price is still shown in brackets.
- **Source:** the latest published statement of the route's city (latest period, then latest version), fee lines whose route code is the route's code: total fees divided by the number of fee lines, rounded to the cent. Offsets and claims are not part of it. Voiding the statement removes the figure.
- **Owner only.** The figure is company revenue, so only a superadmin's request gets it. City admins get the same route list as before, without it.
- A weekly route with no statement lines, a daily route and an older database without the statement tables show the stored price as before.

## Database

None. One read-only query (a `SELECT`) per page of routes.

## Config and dependencies

None.

## Money impact

None. No stored price, pay, claim or revenue figure changes. On the owner's local copy the one published Shreveport statement gives 1.63, 1.64, 1.60 and 1.66 per delivery on its four routes; this matches the statement lines (for example 1,048,790 cents over 6,453 lines is 162.53 cents, shown as 1.63).

## Tested

- `routeStatementPrices.test.js` (no database): per-delivery figure and rounding, a route without lines gets none, published weekly fee lines only, read-only SQL, empty input, older database, other errors are raised.
- `routeCompanyRates.test.js`: the cell shows the stored price, or the statement figure with the week, with a non-zero stored price in brackets.
- Real local database: the service output matches the raw statement lines for all four Shreveport routes; the other 95 routes have no figure.
- Frontend: 57 files, 507 tests; build ok. Backend CI-style run: 259 pass, 0 fail (75 skipped, database tests).
- Not tested: a real browser; the route list response for a city admin (the code only adds the figure when the role is superadmin).

## Risks and follow-ups

- The figure is an average over the week's fee lines, not a configured price. If the carrier pays different rates within a week it shows the blend.
- The figure appears only after the revenue is published (the owner's weekly add, or the owner's review in the GOFO import history). A city admin's upload does not show one until the owner publishes it.
- The edit form is unchanged and still hides the company inputs for a weekly city with a statement.

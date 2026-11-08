# Review fix for PR #258: retiring company prices never erases them

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR #258; branch `feat/gofo-retire-company-prices`
- Type and scope: fix, `Backend/services/finance/companyRates.js`, `Backend/controllers/admin/routeController.js`, the route form helpers and their tests. No reserved file.

## What and why

Jasil's review found that retirement behaved differently across routes of one city. The form treated every route of a weekly city with a verified statement as retired, but
saving any route wrote both company prices to 0, while untouched routes kept their prices. Calculations then estimated an unverified week for untouched routes and left it empty
for saved ones, and voiding the last statement re-enabled the fields on prices that had been erased.

One retirement state now drives everything (a weekly city with a published statement):

- Reads: the fields are hidden in the form, and the route table shows "Carrier statement", plus the stored price as "estimate fallback" when there is one.
- Writes: `companyPricesToStore` ignores whatever the request carries for the company prices and keeps the route's stored values (a new route in such a city stores 0, "no company rate").
  Nothing is overwritten with 0 any more.
- Calculations: unchanged and the same for every route. The stored prices remain the fallback for the ESTIMATE of a week that has no verified statement (labelled estimated);
  a week with a statement takes its revenue from the statement. A weekly route whose prices are both 0 still gets no estimate.
- Voiding the last statement shows the same fields again, with the values they had.

Routes that were already saved as 0/0 by the first draft of this PR keep 0/0 (they were never merged to a shared database; nothing to repair there).

## Database, config, dependencies

None.

## Money impact

None for statement weeks. Estimated figures for weeks without a statement are the same on every route of a city, as they were before this feature.

## Tested

- `tests/companyRates.test.js` on a clean local copy of the database (PAYROLL_TEST_DB=1): an untouched route and a route saved after publication give the same estimate for an
  unverified week (7.50), saving keeps the stored prices, and after a void the prices are back unchanged. Unit test of `companyPricesToStore`.
- Frontend `routeCompanyRates.test.js` (3 tests). Backend `npm test`: 235 pass, 71 skipped (database tests, run by hand above).

Not tested: the route form in a browser after this change; saving a route through the HTTP endpoint (the decision is in the tested helper, the controller only calls it). I also
changed the update handler to look the route up (and answer 404 or 403) before checking the numbers, so a missing route now answers 404 even if the body is malformed.

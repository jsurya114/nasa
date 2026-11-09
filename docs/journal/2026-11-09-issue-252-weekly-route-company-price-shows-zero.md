# Routes table shows the stored company price (0) for weekly GOFO routes

- Date: 9 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR: see the pull request for branch `fix/weekly-route-company-price-zero`
- Type and scope: fix(ui), frontend only
- Files touched: `routeCompanyRates.js`, `routes-form.jsx`, `routeCompanyRates.test.js`. None is reserved.

## What and why

The Routes table showed the words "Carrier statement" in the company price column of a weekly GOFO city that has a verified statement. The owner wants the column to show the price, which is 0.00 for weekly routes, as it does for every other route. The column now always shows the stored company route price. The note in the route form that explains weekly cities take revenue from the carrier statement, and the hidden company inputs in that form, are unchanged.

## Database

None. On the local copy the company route and double-stop prices of all 17 weekly GOFO routes were already 0.00; nothing in the data was changed.

## Config and dependencies

None.

## Money impact

None. Display only; no stored price, pay or revenue calculation changed.

## Tested

- `routeCompanyRates.test.js`: the table cell returns the stored price, 0 and 2.5.
- Not tested: a real browser.

## Risks and follow-ups

A weekly route that still holds a non-zero stored company price (kept as an estimate fallback) now shows that number, as a daily route would.

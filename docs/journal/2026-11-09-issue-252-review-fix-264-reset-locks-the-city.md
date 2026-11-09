# Review fix for #264: the reset locks the weekly city until the write is done

- Date: 9 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR: #264 (branch `feat/reset-weekly-company-prices`)
- Type and scope: fix(routes), backend only
- Files touched: `companyRates.js`, `companyRates.test.js`. None is reserved.

## What and why

Jasil's review found that the reset checked "is this city weekly?" and then wrote the new prices as two separate queries. If a city was edited from weekly to daily between the two, the reset still succeeded and erased the daily city's company prices, which are its revenue.

`resetCompanyPrices` now runs in one transaction. It reads the city with `SELECT ... FOR SHARE`, which holds the city row until the transaction ends: an edit to the city's type (or name) has to wait for the reset to finish, and a reset that arrives after the edit sees the new type and is refused. The route update is in the same transaction. The route, controller, button and responses are unchanged.

## Database

None. No schema change. The only difference is the row lock taken during the reset.

## Config and dependencies

None.

## Money impact

None to pay or saved records. It closes a case where daily company prices could have been erased.

## Tested

- `companyRates.test.js` (no database): the reset runs as BEGIN, locked city read, update, COMMIT; a daily or unknown city never reaches the update.
- Regression for the review finding (two real connections, runs only with a test database, creates and removes its own made-up city and route): while one connection is changing a weekly city to daily and has not committed, the reset waits; after the commit it answers "not weekly" and the route keeps its company prices. Run against the previous code the same test fails; against the fix it passes.
- Backend CI-style run: 260 pass, 0 fail (76 skipped, database tests). Frontend: 58 files, 511 tests pass.
- Not tested: a real browser.

## Risks and follow-ups

A city edit made at the very moment of a reset waits a moment for it; the reset is a single short update, so the wait is brief.

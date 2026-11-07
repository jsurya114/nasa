# Carrier statements: owner-only routes (stage 2b)

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; branch `feat/gofo-statement-api` (stacked on `feat/gofo-statement-store`, PR #254, which is stacked on PR #253)
- Type and scope: feat(excel). New files: router, service, route file, test. One existing file changed: `Backend/app.js` (one import and one mount line). No reserved file touched.

## What and why

The routes the owner uses to bring a carrier statement into NASA, all under `/admin/finance/gofo-statements` and for the **super admin only**. The router checks the token, then the
role, before any route runs, answers `no-store` so company figures are never cached, and is rate limited.

- `GET /` the statements, newest week first, with delivery revenue, claims, adjustments, settlement payable, matched and unallocated revenue.
- `POST /preview` (file): everything publishing would check and what it would do. Stores nothing.
- `POST /publish` (file): stores a statement that reconciles. 201 published, 200 same statement again (nothing changes), 409 an older version, 422 rejected with the reasons.
- `GET /:id/unallocated`: the unmatched money of a statement and why.
- `POST /:id/rematch`: matches groups whose work reached NASA after the statement. Matching only moves unmatched to matched.
- `POST /:id/void` (`{ reason }`, 5 to 300 characters): retires a published statement; its rows stay.

The file is kept in memory only (25 MB limit, one file), must be a zip (.xlsx) and is never written to disk. Who published comes from the token, never from the request. Errors
answer a safe message; internals are logged by code and message only.

## Database, config, dependencies

None (the tables are in PR #254). `multer` and `express` are already dependencies.

## Money impact

None. The routes read and write only the carrier statement tables. No payroll table, pay run, rate or Dashboard figure is read or written.

## Tested

`tests/gofoStatementApi.test.js` (6 tests, no database, the real `requireRole`): no token, a city admin and a driver are refused on every route before any service call; the owner
can use every route and nothing is cached; every publish result has its own status; a missing file, a non-workbook and a too-large file are refused; bad ids and missing
reasons are refused; an unexpected failure leaks nothing. The real route module loads and `app.js` parses.

Not tested: a full upload through a browser (the screen is part 5); running against production-sized files over HTTP.

## Risks and follow-ups

The only edit to a shared file is the mount in `app.js`. The screen for these routes follows with the Insights work.

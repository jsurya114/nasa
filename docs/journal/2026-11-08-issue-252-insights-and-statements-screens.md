# Screens for revenue, margin and carrier statements (stage 4b)

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; branch `feat/gofo-insights-ui` (stacked on `feat/gofo-statement-economics`, PR #259, on #258, #257, #256, #255, #254, #253)
- Type and scope: feat(ui). **Reserved file edited at Jasil's request: `Frontend/src/components/Admin/Dashboard.jsx` (the owner's summary lines only).** Jasil, please review that hunk.
  Also the Insights components, a new owner-only page, `App.jsx` and `Nav.jsx` (one route and one link each).

## What and why

- **Insights** now shows the owner four separate figures: **Delivery revenue** (with where it comes from: "what the carrier billed", "stored daily figures" or an explicit **Estimated** badge and sentence when weekly records
  have no verified statement), **Driver earnings** (gross, with the figure after insurance withholding under it), **Delivery margin**, and **GOFO settlement payable** (by billing week, with delivery revenue, carrier claims and
  ledger adjustments as its own lines; prepayments and withdrawal fees excluded). Unallocated carrier revenue is named inside the revenue card. Rankings and the trend table say which cities and periods are estimates, and
  the labels are the same everywhere (Delivery revenue, Delivery margin). An older server that has not sent the new fields still renders: the older names carry the same numbers. "Estimated" is always a word, never colour alone.
- **Dashboard totals** (super admin): the summary shows Delivery Revenue, Driver Earnings (gross), Delivery Margin and, when there is some, Unallocated (carrier), from the same definition as Insights, with "(estimated)" when it applies.
  A server that has not sent them gets the old "Total Company Earnings" line.
- **Carrier statements page** (`/admin/carrier-statements`, link "Statements", super admin only: the route guard and the API both check): choose a file, **Check statement** (stores nothing; shows the city, billing week, amounts, matched and
  unallocated revenue, the groups that matched nothing and why, NASA work the carrier did not bill, and what publishing would do), then **Publish**. A statement that does not reconcile lists every reason and cannot be published; the
  same statement again or an earlier version cannot be published; a correction says it becomes the next version. The list shows each statement's revenue, driver earnings, margin before claims and adjustments, claims, adjustments,
  contribution, settlement payable, driver earnings after insurance, unallocated revenue and NASA's delivery count beside the carrier's. Actions: show the unallocated lines with the reason, match again, void with a reason, export CSV.

## Database, config, dependencies

None.

## Money impact

None to pay. Display only: every number is the exact text the server sent; nothing is recomputed in the browser.

## Tested

- Frontend suite: 487 tests, all pass. New: `CarrierStatements.test.jsx` (8: figures apart, empty and error states, unallocated lines, check-then-publish with nothing stored before Publish, refused statement with all reasons,
  correction / already published / older version, refused request, void needs a reason), `Insights.test.jsx` (5 new: the four figures, Estimated badge and sentence, unallocated line, older server, ranking and trend estimates),
  `revenueFigures.test.js`, `ownerRevenueRows.test.js`; the existing Insights tests were updated for the new labels. `vite build` succeeds and ESLint is clean on the changed files.
- By hand in a browser (Chrome DevTools) against a scratch copy of the database holding two real statements, signed in as a throw-away super admin created there for the check (removed afterwards): the page lists both statements; uploading
  the Lafayette file through the real file input shows "already published" with Publish disabled; the Insights cards for 28 Sep to 25 Oct equal the sum of the two statements to the cent (revenue, margin, driver earnings and
  settlement payable); no horizontal overflow at phone width. Amounts are not recorded here because this repository is public.

Not tested: a city admin's browser session (covered by the server tests that refuse them: the API tests for the routes and the Dashboard summary test); real publishing through the browser (the same publish is covered by the server tests).

## Risks and follow-ups

Cities with no statement yet show Estimated until one is added. The old "Total Company Earnings" line remains only as a fallback for an older server.

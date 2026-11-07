# One revenue and margin definition for every report (stage 4a, backend)

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; branch `feat/gofo-reporting` (stacked on `feat/gofo-pay-guards`, PR #256, on #255, #254, #253)
- Type and scope: feat(analytics). **Reserved file edited at Jasil's request: `Backend/services/admin/dashboardQueries.js` (`getSummaryData` only).** Jasil, please review that hunk.
  Also: reporting views migration, `services/reporting/*`, `services/insights/trendSeries.js`, the connector's tool schemas and `docs/INSIGHTS_MCP.md`.

## What and why

Weekly GOFO revenue was an estimate from configured company prices. It is now what the carrier billed, with NASA's stored driver earnings as the cost, through ONE definition that
the Insights overview, rankings and trends, the Claude connector and the Dashboard totals all use (`services/reporting/revenueSql.js` and the `reporting.delivery_facts` view).

- **Delivery revenue**: weekly record covered by a verified statement = the carrier's matched fees (shown on one record per Delivery ID, day and route); daily SpeedX = stored driver
  earnings + stored company earnings (`recorded`, unchanged); a weekly record in a week with no verified statement = the old price-based figure, labelled `estimated` and flagged
  `revenueIsEstimated` with a warning. A record with no usable amounts adds nothing and is counted, never zero.
- **Driver earnings** are always NASA's stored gross figure. **Delivery margin** = revenue - driver earnings. Work the carrier did not bill has revenue 0, so its cost shows.
- **Unallocated** carrier money (no route, unknown route or driver, no recorded work) is kept, attributed to the statement's city and the carrier's signing day, added to revenue and
  margin, and shown apart (`unallocatedRevenue`); it has no driver, no deliveries, and a daily-only question has none.
- **Settlement** (`settlement`: statements, delivery revenue, carrier claims, ledger adjustments, payable) is by BILLING WEEK, counted in the period holding the last day of the week.
  Trends use the signing day. Prepayments and withdrawal fees are excluded. Carrier debits are kept apart from driver recoveries and insurance withholding;
  `driverEarningsAfterInsurance` subtracts insurance only.
- Existing fields keep their names and values (`earnedDeliveryRevenue`, `grossMarginBeforeOverheads`, `grossDriverEarnings`); new fields are added beside them
  (`deliveryRevenue`, `driverEarnings`, `deliveryMargin`, `unallocatedRevenue`, `revenueBasis`, `revenueIsEstimated`, `recordsByBasis`, `settlement`). The connector's output schemas and the
  metric definitions (version 2026-11-08) say the same words. Both trend implementations and the city ranking use the same SQL pieces.
- **Dashboard totals** (`getSummaryData`): the owner now also gets `total_delivery_revenue`, `total_driver_earnings`, `total_delivery_margin`, `total_unallocated_revenue` and
  `revenue_is_estimated`, from the same view joined on the same rows, so they equal the Insights numbers. **Access fix**: `total_company_earnings` used to be returned to city admins in the
  API response (the screen hid it). It and every new company figure are now read only for the super admin; a city admin's response has none of them, and the join to the revenue view is not made for them.

## Database

`Backend/migrations/2026-11-08-issue-252-reporting-statement-revenue.sql` (+ rollback). Replaces `reporting.delivery_facts` keeping every existing column and appending
`delivery_revenue`, `delivery_margin`, `revenue_basis`, `revenue_complete`, `statement_id`, `insurance_withheld`; adds `reporting.statement_unallocated` and `reporting.carrier_statements`;
grants SELECT on the three views to `nasa_reporting_reader` when that role exists (the reporting login still sees only views). Needs the carrier statement migration (PR #254) and the
reporting migrations of issue #220 first. Safe to run twice (applied twice on a copy). Run as the database owner, after a backup, on a copy first.

## Money impact

Weekly cities with a verified statement: revenue and margin are the carrier's billed amounts instead of price-based figures; driver earnings, pay runs and payments are unchanged.
Weeks without a statement: unchanged numbers, now labelled estimated. Daily SpeedX: unchanged. On a copy of the local database with a real Lafayette statement published, every cent
of delivery revenue matched NASA's records (see the PR for the totals; amounts are not recorded here because this repository is public).

## Tested

- `tests/revenueDefinition.test.js` (needs `PAYROLL_TEST_DB=1`, rolled-back transaction, made-up data): estimated before a statement; daily SpeedX recorded and unchanged; with a statement, revenue is
  the carrier's 4.91 against 6.50 of driver earnings and a -1.59 margin; summary, ranking and both trend implementations show the same numbers and keep revenue on the signing day;
  settlement by billing week and absent for a period that does not contain the week's last day; Dashboard totals equal the reports for the owner and a city admin gets no company figure;
  unallocated revenue is kept, shown apart, adds no driver earnings, and is absent for a daily-only question. Net of insurance only is checked.
- The existing reporting, Insights and connector suites (including the comparison with the Dashboard's own totals) pass unchanged against the new view; the comparison now also checks the new fields.
- The whole backend suite: 302 tests, 0 failed (70 skipped, the database ones CI does not run, which I ran by hand on a copy).

Not tested: the reporting login (`REPORTING_DB_*`) against the new views (no such login on this machine); the Insights and Dashboard screens (next part); production-sized data.

## Risks and follow-ups

Cities whose weekly statements are not uploaded yet show `estimated` figures. Part 4b updates the screens, part 3b stops asking for company prices on weekly routes, part 5 backfills older statements.

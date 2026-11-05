# NASA Insights: reporting role, shared reporting services and the first data tools

- Date: 2026-11-06
- Author: Jasil (with Claude)
- Issue / PR: #220
- Branch: `feat/insights-reporting-tools` (contains the connection milestone, PR #222)
- Type and scope: feat(analytics), backend only

Second milestone of the private read-only connector: real business answers, through a database login that can only read.

- Add migration `2026-11-06-issue-220-reporting-views` (and rollback): schema `reporting`, views `cities` and `delivery_facts`, and a
  group role `nasa_reporting_reader` that can read only those views. No base table, sign-in record or account is readable by it.
- Add `Backend/services/reporting/`: input checks (`inputs.js`), the restricted connection (`reportingDb.js`: its own login, small
  pool, READ ONLY transactions, time limit, cancellation) and the reports (`deliveryReports.js`). Plain functions, no Express or MCP
  types, so the Insights page can call them.
- Add tools `list_reporting_cities`, `get_business_summary` and `rank_cities`. They are offered only when `REPORTING_DB_*` is set,
  and the application's database login is never used for reports.
- Revenue = stored driver earnings + stored company margin from the same records; margin is "gross profit before overheads".
  Open or half-filled records are counted in deliveries, left out of revenue and margin, and disclosed; nothing is recalculated from
  today's route rates; cities follow the record's route; the Dashboard's daily/weekly city rule is applied.
- Add settings placeholders to `.env.example` and the role setup, what-the-numbers-count and tools sections to the setup guide.

Database: two views and one group role, additive; the login role is created separately by the operator (no password in the repo).
Dependencies: none new. Money calculations in NASA: unchanged; reports only read.

Validation: 24 new tests plus the 21 from #222. Pure tests for dates, limits, exact cents arithmetic and rounding. Fixture tests in
a rolled-back transaction: exact totals across daily and weekly cities, open, half-filled, rule-breaking and out-of-period records,
a driver changing city and a route changing rate (history unchanged), previous-period comparison (complete, incomplete, absent),
empty period, ranking by each metric with shares, and no change to the business tables. Role tests with a real read-only login:
it cannot read any base table or sign-in record, cannot write, create or drop, a slow query is stopped by the time limit, and a
cancelled request cancels its query and frees its connection. HTTP tests through the real sign-in: only the definitions tool without
a reporting login, bad input explained, and the tools' deliveries, driver earnings, margin and revenue equal the Dashboard's own
`getSummaryData` totals for every city and two periods. Full backend suite passes. **Not done:** claims, payment overview, trends,
driver ranking (next pull requests); staging and mobile checks; comparison against the Insights page (not written yet).
# Review follow-up — 6 November 2026

- Resolved the conflicts caused by the connector dependency's squash merge
  by merging current `develop`, preserving branch history. Before the consent
  copy change, the resulting tree exactly matched current `develop` plus the
  already-reviewed reporting-tools commit.
- Corrected the consent page to name metric definitions and the available
  city, delivery, revenue, gross-margin and city-ranking reports. Claims and
  payment-status reports are not offered in this milestone.
- Re-ran the complete backend suite on an isolated database with a separate
  reporting login: 196 passed, zero failed, 54 skipped. MCP sign-in and the
  reporting permission, cancellation and Dashboard-comparison checks ran with
  their database settings enabled. Unrelated database suites stayed skipped.
- Driver-name disclosure for a future ranking tool remains an owner decision.
  Certificate-verification changes belong to a coordinated application and
  reporting-connection follow-up. Neither behavior changed in this update.

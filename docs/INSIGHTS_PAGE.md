# Insights page: plan and API

| Field | Value |
|---|---|
| Issue | #227 |
| Status | In progress. PR 1 (the API, #229) and PR 4 (the page foundation) are done; the rest is the plan below. |
| Owner | Jayasoorya |
| Related | `docs/INSIGHTS_MCP.md` (the Claude connector, #220). Both read the same reporting layer. |

Insights is the owner's read-only business overview: how deliveries and revenue perform, which cities and drivers lead, and where to act. It is for the **super admin only**, on the page and on the API. It never recalculates pay, changes a rate, touches a claim, marks anyone paid or calls Everee. The Dashboard stays the tool for daily operations.

## Rules the numbers follow

The definitions are in `Backend/services/reporting/metricDefinitions.js` and in `docs/INSIGHTS_MCP.md` section 6; the page and Claude read the same file. In short:

- Figures are **stored** amounts, aggregated on the server over the whole filtered period, never a Dashboard page. Revenue = stored driver earnings + stored company margin. Margin is "gross profit before overheads", not net profit. Margin % = margin / revenue, N/A when revenue is zero.
- A record still open or with only one of the two amounts counts in deliveries but not in revenue or margin, and says so. Missing is never zero.
- A city's records are those of its routes, so a driver who moves city never moves old deliveries. A DAILY city counts records with sequence numbers and a WEEKLY city those without (the Dashboard's rule).
- Money is exact (cents), USD. A comparison with the previous equal-length period is shown only when it means something: otherwise `insufficient_data`, or `incomplete` with the reason.
- One record is an aggregate, not one order. "Unique orders" is never claimed.

## API (all `GET`, super admin only, read only, never cached)

| Route | What it returns | Parameters |
|---|---|---|
| `/admin/insights/definitions` | The metric definitions and limits. No data is read. | none |
| `/admin/insights/cities` | Cities with their type and first and last delivery date. | none |
| `/admin/insights/overview` | Deliveries, earned revenue, driver earnings, margin and margin %, active drivers, per-delivery figures, record counts, and the comparison with the previous period. | `start_date`, `end_date` (required, `YYYY-MM-DD`, at most 1096 days), `city_ids` (comma list), `source` (`daily` or `weekly`), `compare` (`false` to leave it out) |
| `/admin/insights/rankings/cities` | Cities ranked by deliveries, revenue or gross margin, each with its share of the total. | the same filters, `rank_by` (`deliveries`, `revenue`, `gross_margin`; default `revenue`), `limit` (1 to 50, default 10) |

Every answer is `{ meta, data }`. `meta` holds `generatedAt`, `definitionsVersion`, `units`, `scope` (what was asked), `coverage` (first and last date, days with records) and `warnings`. The page shows `generatedAt` and the last delivery date as "data as of". A refused request answers 400 with a message; a failure answers a generic message with no SQL. The report runs in a READ ONLY transaction with a 10 second limit, on the restricted reporting login when `REPORTING_DB_*` is set and otherwise on a read-only connection of the application's pool. It needs the reporting views (`Backend/migrations/2026-11-06-issue-220-reporting-views.sql`) applied to that database.

## Plan: small pull requests into `develop`

Jasil's #228 (trends, driver ranking, claim exposure, payment overview, forecast) already builds the reporting functions that the original steps 2 and 3 would have written, as plain functions in `Backend/services/reporting/`. Insights does not repeat them: it wraps them, so the page and Claude share one set of definitions. The order, with what each step needs:

1. **API foundation** (#229, open): the guarded router, the report runner, overview, city ranking, cities and definitions; an optional `source` filter and a city filter on the shared functions.
2. **Page foundation** (this document's PR, stacked on #229): the lazy-loaded super-admin route and menu entry, the header filters (presets Last 7, Last 30, This month, Last month, Custom; default Last 30 days and All cities; the city; the record source), the KPI cards with the previous-period comparison, the top cities ranking with a table alternative and click-to-filter, the data-as-of panel, and every state (loading, empty, error, refused). No chart library yet.
3. **API: trends and drivers** (needs #228 merged): `/admin/insights/trends` and `/admin/insights/rankings/drivers` wrapping `deliveryTrends` and `rankDrivers`, with the same `source` filter added to them.
4. **UI charts**: revenue and margin trend and delivered-volume charts, the driver leaderboard, the calendar heatmap and the weekday bars, each with a table alternative. Adds Recharts (pinned; React 19 and bundle size checked) only here, where it is used.
5. **API and UI: claims and "Needs attention"** (needs #228): claim exposure, payment backlog and data completeness, with "as of" labels; driver advances, debts and penalty balances through the canonical Payroll services, which #228 leaves out on purpose.
6. **Polish and acceptance**: mobile and accessibility review, reduced motion, validation against the Dashboard's own totals, documented limits.

Each pull request carries tests for daily and weekly data, city transfers, claim exemptions and unmatched claims, empty data and zero denominators, join duplication and role access, plus a journal entry.

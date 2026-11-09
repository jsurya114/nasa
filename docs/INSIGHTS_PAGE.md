# Insights page: plan and API

| Field | Value |
|---|---|
| Issue | #227 |
| Status | In progress. The API (#229, merged), the page foundation, and the trend charts, weekday bars and calendar are done; the rest is the plan below. |
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

1. **API foundation** (#229, merged): the guarded router, the report runner, overview, city ranking, cities and definitions; an optional `source` filter and a city filter on the shared functions.
2. **Page foundation** (merged with the charts' branch base): the lazy-loaded super-admin route and menu entry, the header filters (presets Last 7, Last 30, This month, Last month, Custom; default Last 30 days and All cities; the city; the record source), the KPI cards with the previous-period comparison, the top cities ranking with a table alternative and click-to-filter, the data-as-of panel, and every state (loading, empty, error, refused). No chart library yet.
3. **Trends API and charts** (done in the charts PR): `GET /admin/insights/trends` returns deliveries, earned revenue and gross margin per day, week (Monday start) or month, the weekday pattern and the busiest dates, from `Backend/services/insights/trendSeries.js`. It has the same rules and output shape as the connector's `get_delivery_trends` in #228, so the two can share one implementation once #228 is merged; it was written here so the charts did not wait for that review. Every bucket of the period is present; a bucket with no records has `null` figures and `hasRecords: false` (a gap, never zero). The bucket size is required (`interval=day|week|month`; a daily trend is limited to 366 days). The page draws the lines, the weekday bars and a calendar heatmap with Recharts (pinned 3.10.1, MIT, React 19, no known vulnerabilities), each with a table alternative with the exact figures. Colours follow the validated palette (blue and orange for the two money lines, the brand violet elsewhere). The calendar asks for daily buckets and shows up to a year.
4. **API and UI: the driver ranking and leaderboard** (needs #228 merged): `/admin/insights/rankings/drivers` wrapping `rankDrivers`, with the same `source` filter added to it.
5. **API and UI: claims and "Needs attention"** (needs #228): claim exposure, payment backlog and data completeness, with "as of" labels; driver advances, debts and penalty balances through the canonical Payroll services, which #228 leaves out on purpose.
6. **Polish and acceptance**: mobile and accessibility review, reduced motion, validation against the Dashboard's own totals, documented limits.

Each pull request carries tests for daily and weekly data, city transfers, claim exemptions and unmatched claims, empty data and zero denominators, join duplication and role access, plus a journal entry.

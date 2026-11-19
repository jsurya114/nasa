# Insights connector: plain input errors, and no "busiest weekday" when nothing was delivered

| Field | Value |
|---|---|
| Date | 2026-11-19 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `claude/kind-allen-gt2g1b` (into `develop`) |
| Type / scope | `fix(mcp)` |
| Files touched | Backend: `services/reporting/trendReports.js`, `services/reporting/inputs.js`, `services/mcp/tools/deliveryTools.js`; tests `mcpFriendlyInput` (new), `reportingTools` (updated). Journal entry. |
| Reserved files touched | None. No pay, Excel or dashboard file. |

**What and why.** Two problems found while testing the connector from Claude before the client presentation.

1. **Busiest weekday with nothing delivered.** For a city and period whose records all show zero completed deliveries (for example a daily city whose
   days are still open), `get_delivery_trends` named a "busiest weekday" with an average of 0.00 and listed a peak date with 0 deliveries. It now names no
   busiest weekday, ranks no weekday, and lists no peak date when no weekday has a completed delivery, and says so in the warnings. A day that has
   records but zero deliveries is still reported in the series and the weekday totals. When there are real deliveries, the ranking and peak dates are
   exactly as before (the rule moved into two small functions, `weekdayProfile` and `peakDatesFrom`, so it can be tested without a database).
2. **Raw schema errors.** Out-of-range numbers (`limit` over 50, `days` over 28, `min_active_days` over 31, more than 50 `city_ids`) were refused by the
   MCP library's schema check with a technical message (`MCP error -32602 ... Too big: expected number to be <=50`). The numeric limits are now checked
   by the tool, which answers in plain words ("limit must be a whole number from 1 to 50"), as the date and city errors already did. The allowed range
   is written in each argument's description, so Claude still knows it. Wrong types, unknown arguments and unsupported choices (`rank_by`, `interval`)
   are still refused by the schema. `min_active_days` had no check of its own, so `parseMinActiveDays` was added.

**Database.** None. **Config and dependencies.** None.

**Money impact.** None. No amount, rate or revenue rule changed; the summary, city ranking, claims, payments and forecast tools are untouched.

**Tested.**
- New `mcpFriendlyInput` 6 passed: zero-delivery records give no busiest weekday, no rank and no peak date while the day is still reported; with deliveries the
  ranking and peak dates are unchanged; out-of-range numbers pass the schema so the tool can explain them; wrong types and unknown arguments are still refused; the
  descriptions still state the ranges; `min_active_days` messages.
- Whole Backend suite before and after, on a copy of `develop` and on this branch, without a database and with a reduced install (the `xlsx` package could not
  be downloaded here): the same 56 test files fail in both (missing packages and database), 6 more pass after.
- Live check of the original findings through the connector before the change (Dallas SpeedX, 1 to 7 Nov, daily).

**Not tested.** The updated HTTP cases in `reportingTools` (limit, `min_active_days`, forecast `days`) need the test database and the reporting login, so they were not
run here. The fixed connector was not re-run from Claude, because the running backend has to be redeployed with this change first.

**Risks and follow-ups.**
- The Insights web page has its own copy of the weekday rule (`services/insights/trendSeries.js`) and still names a busiest weekday for all-zero records. Not changed here.
- Found in the same test and not fixed here: the payment overview's per-city list shows an unconfirmed payment under "processing"; `rank_drivers` reports 319 drivers with
  records but 318 in its warning; one week showed a small negative unallocated revenue; the forecast can start on days that have already passed. Dallas SpeedX has
  almost no records for 1 to 7 Nov, which is a data question (imports), not a code fault.

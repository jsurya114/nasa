# Insights page, PR 3: trends, weekday bars and the calendar (issue #227)

- **Date:** 2026-11-06
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #227 / the pull request for `feat/insights-trends-charts`
- **Branch:** `feat/insights-trends-charts`, stacked on `feat/insights-ui-foundation` (#230). Until #230 merges this diff also shows its commit: read the last commit.
- **Type and scope:** feat(analytics), backend and frontend
- **Files touched:** new `Backend/services/insights/trendSeries.js`; `insightsService.js` and `router.js` (one new route); `Backend/tests/insightsApi.test.js`; frontend `Insights.jsx`, `Insights.test.jsx`, `insights/{TrendSection,TrendChart,WeekdayChart,CalendarHeatmap,chartData,chartColors}` and `insightsDates.js`; `Frontend/package.json` and lockfile; `docs/INSIGHTS_PAGE.md`. No reserved file (Excel, pay, dashboard queries) is touched.

**What and why.** The first Insights screens had figures and city bars only. The owner asked for real graphs. This adds, for the same filters as the rest of the page:
- **Trends:** a line chart of deliveries and a line chart of earned revenue and gross margin (one dollar axis, two lines) by day, week or month. The bucket size follows the length of the period (days up to 45 days, weeks up to about a year, months beyond) or is chosen with Auto, Day, Week, Month.
- **Busiest weekdays:** average deliveries on a weekday, over the days that have records, with the busiest in the stronger shade.
- **Calendar:** one square per day, weeks in columns, five shades from the busiest day.
- A table with the exact figures for each of them, a tooltip with the exact value, and a plain note when there is nothing to draw.

**Honesty rules kept.** A period with no records is a gap in the line and a dashed square in the calendar, never zero; a weekday with no records is blank. A record still open counts in deliveries but not in revenue or margin, and the page says so. The server's notes (data ends or starts on a date, days without records, partial first and last weeks) are shown under the charts. Nothing is calculated in the browser except choosing and grouping what the server sent.

**API.** `GET /admin/insights/trends?start_date&end_date&interval=day|week|month[&city_ids][&source]`, super admin only like every Insights route, one read-only report with the existing timeout and cancel-by-pid safety. It uses the same view, date field, city rule and stored amounts as the overview. Written here, with the output shape of the connector's `get_delivery_trends` (#228), so the two can share one implementation after #228 is merged; #228 was not touched.

**Database / config / dependencies.** Database: none (it reads `reporting.delivery_facts`, which the earlier migration creates). Config: none. **Dependency added: `recharts` 3.10.1**, pinned exactly (MIT, supports React 19, `npm audit --omit=dev` reports 0 vulnerabilities). It brings d3 helper packages, `es-toolkit`, `immer` and similar (about 28 packages in the lockfile). The Insights page is a lazy chunk, so only the super admin who opens it downloads the library: the chunk went from about 22 kB to about 464 kB (122 kB gzipped). No other page changed size.

**Money impact.** None. Display only; no pay, rate, claim or Excel logic is touched. Totals of every trend interval equal the overview's totals for the same filters (tested).

**Tested.**
- Backend, 4 new tests plus the existing access and bad-input tests extended to the new route: week starts on Monday, month starts and leap-year/year-end edges, every bucket that touches the period; the route is refused for a non-super-admin and for a missing or bad interval, an unknown source, a daily trend over 366 days; with a database, every interval (day, week, month) for five filter combinations adds up to the overview's deliveries, revenue and margin, days without records are `null` not zero, weekday totals add up, the busiest weekday and peak dates, an empty filter, a record still open, an unknown city. Mutation checks: removing the source filter fails 5 tests; moving the week start by a day fails the bucket test.
- Frontend: 44 tests in the insights folder (chart data, bucket choice, heatmap rules, month labels), and 8 new page tests with a fake server (charts and legend drawn, calendar reuses the daily answer, the gap and the dashed square, tables with N/A, weekday table, longer period asks for week plus its own daily answer, over a year no calendar and Day disabled, empty and failed states, changing the city shows loading and never the old charts). Full serial run: 316 of 316; backend without a database: 166 pass, 0 fail, 59 skipped; Insights with a database copy: 18 of 18.
- **Real browser**, on a disposable copy of a development database, a separate backend and frontend and a throwaway super admin (removed afterwards): daily lines for the real Shreveport week with tooltip values, weekday bars with all seven labels, calendar with dashed no-record days and the readout, the weekly view (one week of data draws one dot, as it should), and a phone-width check with no horizontal overflow.
- Found and fixed in that check: the weekday chart hid most day labels; month labels in the calendar skipped a month that starts mid-week (now the ISO Thursday rule); several "Show as table" buttons on one page had the same accessible name (now "Show as table, trends" and so on).

**Not tested.** Safari and Firefox, a screen reader, a period of several years with real data (the server limits and tests say it is capped, but only a few weeks of real data exist), the Spanish language (Insights is English only), dark mode (the app has none).

**Risks and known limits.** The trends function is a second implementation next to #228's `deliveryTrends` until they are merged into one; both are tested against the same rules. The calendar cells are not keyboard-focusable on purpose (up to 366 tab stops); the table view is the keyboard and screen-reader route. The library makes the Insights chunk much larger, which only matters on first open of that page. Driver leaderboard, claims and "Needs attention" are still to come.

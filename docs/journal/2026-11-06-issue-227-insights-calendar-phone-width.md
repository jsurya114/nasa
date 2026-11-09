# Insights: the calendar no longer widens the page on a phone (issue #227)

- **Date:** 2026-11-06
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #227 / pull request #231 (a fix to Jasil's review, same branch)
- **Branch:** `feat/insights-trends-charts`
- **Type and scope:** fix(analytics), frontend only
- **Files touched:** `Frontend/src/components/Admin/insights/CalendarHeatmap.jsx`, `WeekdayChart.jsx` (one class each), `Frontend/src/components/Admin/Insights.test.jsx` (one test); this entry. No reserved files.

**The finding (Jasil's review of #231, P1).** With a valid one-year period (2025-11-01 to 2026-10-31) on a 390 px phone, the page became 977 px wide and the weekday and calendar cards about 966 px, so the whole page scrolled sideways instead of only the calendar. My earlier phone check used short periods and did not catch it.

**Cause.** The weekday and calendar cards are the two items of a CSS grid. A grid item has `min-width: auto`, so it will not become narrower than its content: a year of calendar weeks. The calendar's own `overflow-x-auto` wrapper could never take effect because its card was already as wide as the calendar.

**Fix.** `min-w-0` on both cards (the weekday card is the other item of the same grid and could do the same). The calendar keeps its inner scroller. No other change.

- **Database:** None. **Config and dependencies:** None. **Money impact:** None; display only, no report or request changed.

**Tested.**
- **Real browser, before and after** (a disposable copy of the development database, a separate backend and frontend on other ports, a throwaway super admin that existed only in that copy; all removed afterwards), 390 px phone, 2025-11-01 to 2026-10-31: **before** the page was 977 px wide and both cards 966 px (Jasil's numbers); **after** the page is 390 px (equal to the screen), both cards 366 px, and the calendar scrolls inside its own card. Also checked with the calendar in table view and with both charts in table view: the page stays 390 px. At a 500 px window the page is 485 px.
- New test in `Insights.test.jsx`: both cards have `min-w-0`, are the two items of the same grid, and the calendar keeps its scroll wrapper. jsdom has no layout, so it guards the cause rather than the pixels. Checked that it fails without the fix and passes with it.
- Insights tests 53 passed; whole frontend suite and build below.

**Not tested.** Safari and Firefox on a real phone; a phone in landscape.

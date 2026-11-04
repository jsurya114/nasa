# The Dashboard keeps the admin's filters when they leave and come back (issue #186, part 2)

- **Date:** 2026-11-04
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #186 / see the pull request for this branch (follows part 1, the shared hook)
- **Branch:** `feat/keep-dashboard-state` (from `feat/keep-page-state`)
- **Type and scope:** feat(frontend)
- **Files touched:** `Frontend/src/components/Admin/Dashboard.jsx` and `DashboardTable.jsx` (**Jasil's zone**; edited at the owner's request, for Jasil's review), new `dashboard/filterParams.js` (+ test), new `Dashboard.keepView.test.jsx`; this entry. No other reserved files.

**What was reported.** Filter the dashboard (city, driver, dates), open another page, come back: the filters and the table were gone.

**Two causes.**
1. The filter form (city, driver, route, dates, status, the company-earnings box) lived in component state, so it reset on every visit.
2. Every visit asked for today's table, replacing the filtered table that Redux was still holding. The dropdowns were also reloaded with every driver and route, whatever city the form had chosen.

**The change.**
- The form, the "applied" copy of it (taken when Filter Data is pressed), the company-earnings view and the rows per page are kept with the shared hook from part 1 (per person, this tab, cleared at sign-out).
- On opening: the dropdowns are narrowed to the remembered city; if Redux still holds the filtered table (the usual case when going to another page and back) it is left alone; if not (after a reload) the same filters are asked for again, with the summary when the earnings view was on; otherwise today's table, as before.
- Clear Filters forgets the applied view. Changing rows per page still reloads today's table, as before.
- "What Filter Data asks the server" moved into `buildFilterParams` (one place for the button and the restore). It builds exactly the request the button built before.

Not changed: the pay, payment and summary calculations, the server, the Excel upload.

- **Database:** None. **Config and dependencies:** None. **Money impact:** None (what is shown and asked for is the same; it is just kept).

**Tested.** `Dashboard.keepView.test.jsx`: coming back shows the form, narrowed dropdowns and the filtered table without asking for today's; after a reload the same filters are asked again; Clear Filters, and another person on the same browser, see nothing kept. The first two fail on the previous Dashboard files (checked). `filterParams.test.js` (4). Whole frontend suite: 22 files, 206 tests pass; `vite build` succeeds. Lint: no new problems; `Dashboard.jsx` and `DashboardTable.jsx` already had unused-variable errors before this change.

**Not tested.** By hand in the browser or on a phone. The page number of the filtered table is kept when going to another page and back (Redux holds it) but starts again at page 1 after a reload.

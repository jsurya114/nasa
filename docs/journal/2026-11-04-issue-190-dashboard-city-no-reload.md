# Choosing a city on the Dashboard no longer reloads the page (issue #190)

- **Date:** 2026-11-04
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #190 / see the pull request for this branch
- **Branch:** `fix/dashboard-city-no-reload` (from `feat/keep-dashboard-state`, #188)
- **Type and scope:** fix(frontend)
- **Files touched:** `Frontend/src/components/Admin/Dashboard.jsx` (**Jasil's zone**; edited at the owner's request, for Jasil's review), `Frontend/src/redux/slice/admin/dashSlice.js`, new test `Dashboard.cityChange.test.jsx`; this entry.

**What was reported.** Choosing a city in the dashboard filter made the whole page refresh. Only that city's drivers should show, without the refresh. The first filter should say City, not Job.

**Cause.** Asking for a city's drivers (and routes) switched on the same `loading` flag as the first load of the dropdowns, and the Dashboard replaces the whole page with a loader while that flag is on.

**The change.**
- Drivers and routes have their own loading flags (`driversLoading`, `routesLoading`). `loading` is now only for the first load of the dropdown data. While a city's drivers load, only the driver (and route) box waits: it is disabled and its label says "(loading...)". The form and table stay on screen.
- When a city is chosen, the previous city's drivers and routes are cleared at once, so only the new city's drivers can ever be offered.
- Each answer is used only if it belongs to the latest request, so a slow earlier answer can no longer overwrite a later choice.
- The first filter is labelled **City** (the field and the request keep the name `job`, so nothing the server receives changes). The table heading "Driver Jobs" and the "Job Date" column are unchanged.

- **Database:** None. **Config and dependencies:** None. **Money impact:** None.

**Tested.** `Dashboard.cityChange.test.jsx` (3, all fail on the previous code): label order City, Driver, Route; the form stays and the driver box is empty and disabled until the city's drivers arrive, then lists only that city's; a late answer for an earlier choice is ignored. Whole frontend suite: 23 files, 209 tests pass; `vite build` succeeds; no new lint problems (`Dashboard.jsx` already had unused-variable errors).

**Not tested.** By hand in the browser or on a phone. If the drivers request fails, the page still shows the error screen as before.

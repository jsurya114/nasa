# Pages keep what the person set when they leave and come back (issue #186, part 1: hook and admin pages)

- **Date:** 2026-11-04
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #186 / see the pull request for this branch
- **Branch:** `feat/keep-page-state` (from `develop`)
- **Type and scope:** feat(frontend)
- **Files touched:** new `Frontend/src/utils/viewState.js`, `Frontend/src/hooks/usePersistentState.js` (+ test); `Frontend/src/native/sessionStore.js` (one call at sign-out); admin pages `Jobs`, `routes-form`, `AddUsers`, `AccessCode`, `AdminDriverAgreements`, `AdminJorney`, `AdminDriverAvailability`, `DoubleStop`, `Payroll`, `PayRuns`; tests `Payroll.test.jsx`, `PayRuns.test.jsx`; this entry. No reserved files (the Dashboard is left for part 2).

**What was reported.** Anything set on a page (a filter, a search, a page number) was lost when the admin or driver opened another page and came back. Each page kept it in its own component state, which React discards when the page closes.

**The change.** One shared hook, `usePersistentState(area, page, name, initial)`, works like `useState` but keeps the value in `sessionStorage`:
- Private to the tab, gone when the tab closes, kept across a reload.
- Keyed by area (admin or driver) and the signed-in person's id, so someone else signing in on the same device never sees it.
- Removed at sign-out together with the form drafts (`clearSession`).
- A value equal to its starting value is not stored; storage that is blocked or full just means the page works as before; only plain JSON values, at most 20,000 characters each.
- Option `ignoreSaved` for when a link has just chosen the value.

Applied here to: Jobs (search, status filter), Routes (search, city filter), Users (tab), Access codes (search box starts from the search already in use), Driver agreements (search), Journeys (filters, page, rows per page), Driver availability (day, city, status, search, page, rows per page), Double stop (weekly or daily view), Payroll (city and driver; a link from the dashboard wins), Pay runs (city). On Payroll and Pay runs a remembered city the admin can no longer use is dropped once their cities load.

Not kept on purpose: open dialogs, in-progress edits, uploads, and typed text in create forms.

- **Database:** None. **Config and dependencies:** None. **Money impact:** None.

**Tested.** New hook tests (8): works as useState, restored after leaving, nothing stored at the starting value, people and areas kept apart, forgotten at sign-out, id arriving late, storage blocked. Payroll: city and driver remembered, and a dashboard link wins; Pay runs: city remembered. Whole frontend suite: 20 files, 199 tests pass; lint clean on the touched files; `vite build` succeeds.

**Not tested.** By hand in the browser, and on a phone. Only Payroll and Pay runs have page-level tests; the other pages use the same one-line change and are covered by the hook tests and the unchanged suite.

**Follow-ups.** Part 2: the Dashboard (Jasil's area). Part 3: the driver pages.

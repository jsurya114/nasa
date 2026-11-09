# Lint clean-up, part 4: the redux slices (issue #40)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #40 / see the pull request for this branch
- **Branch:** `chore/lint-redux-slices`
- **Type and scope:** chore(frontend)
- **Files touched:** `Frontend/src/redux/slice/admin/accessCodeSlice.js`, `Frontend/src/redux/slice/driver/driverAccessCodeSlice.js`, `driverSlice.js`, `journeySlice.js`. **Not touched (Jasil's zone):** `dashboardUpdateSlice.js` (1 finding) and the other dashboard, payment, upload and analytics slices.

**What and why.** Fixes the 6 lint findings in the slices outside Jasil's zone: an unused `action` parameter in five reducers (`(state, action) =>` becomes `(state) =>`) and an unused `getState` in the agreement thunk. The reducers never read `action`, so what they do is unchanged.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** `npx eslint src/redux`: 0 findings in the files touched (1 left, in Jasil's `dashboardUpdateSlice.js`). `npm run build` succeeds. The whole diff was read: six parameters removed. Not tested: the screens in a browser.

**Risks and follow-ups.** None.

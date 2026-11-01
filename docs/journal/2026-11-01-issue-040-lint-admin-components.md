# Lint clean-up, part 1: the admin components (issue #40)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #40 / see the pull request for this branch
- **Branch:** `chore/lint-admin-components`
- **Type and scope:** chore(frontend)
- **Files touched:** `Frontend/src/components/Admin/`: `AccessCode.jsx`, `AddUsers.jsx`, `AdminDriverAvailability.jsx`, `AdminJorney.jsx`, `Jobs.jsx`, `Login.jsx`, `routes-form.jsx`. **Not touched (Jasil's zone):** `Dashboard.jsx`, `DashboardTable.jsx`, `DoubleStop.jsx`, `DriverPaymentUpdate.jsx` in the same folder.

**What and why.** Issue #40 makes `npm run lint` pass so CI can block on it. This pull request fixes the 20 findings in the admin components that are not in Jasil's zone. No behaviour changes.
- **Unused imports, variables and parameters removed:** `getCities`, `clearError`, `setZipCodeFilter`, `deleteRoute`, an unused `isAuthenticated`, `reduxError`, `limit`, `index`, `e`, a never-read selected-driver state, and two unused `availableDaysCount` lines.
- **Dead functions removed** (nothing called them): `handleFilterChange` in `AccessCode.jsx`, `handleDelete` in `routes-form.jsx`, `getAvailableDays` in `AdminDriverAvailability.jsx`.
- **State that is never set:** `localZipCodeFilter` and `submitSuccess` keep their value (always the empty one) but no longer carry an unused setter.
- **`catch (err)` where the error is not used** is now `catch {`.
- **Hook dependency warnings, checked one by one** (the issue asks for care here). `AccessCode.jsx` and `Jobs.jsx` fetch on purpose only when one input changes (first load, or page change); adding the others as dependencies would fetch twice, so each has a comment saying why and a targeted `eslint-disable` for that one line. `AdminJorney.jsx` sets `errorTimeout` inside the same effect, so listing it would restart the timer in a loop: comment and disable. Its other warning was real: `handleDelete` was re-created on every render, which made a `useMemo` that depends on it recompute every time; it is now a `useCallback` with no dependencies (it only calls two state setters).

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** `npx eslint src/components/Admin`: 0 findings in the files touched here (the 13 left in the folder are all in Jasil's four files). `npm run build` succeeds. The diff was read in full: it only removes unused code, changes `catch (x)` to `catch`, drops unused names, and adds the comments and the one `useCallback` above. Not tested: the screens in a browser (there are no automated tests).

**Risks and follow-ups.** Low. The rest of the folders follow as their own pull requests; Jasil's findings are listed on the issue.

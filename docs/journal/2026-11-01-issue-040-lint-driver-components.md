# Lint clean-up, part 2: the driver components (issue #40)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #40 / see the pull request for this branch
- **Branch:** `chore/lint-driver-components`
- **Type and scope:** chore(frontend)
- **Files touched:** `Frontend/src/components/Drivers/`: `DriverLogin.jsx`, `DriverAvailability.jsx`, `DriverViewAgreement.jsx`, `accessCode.jsx`. No reserved files.

**What and why.** Fixes the 12 lint findings in the driver components, with no behaviour change.
- **Unused names removed:** `clearError`, `error` and `isAuthenticated` in the login screen, the unused result of the login call (`const res =`), `updatedAt`, a `dayName` and a `formatDate` helper that nothing called in the availability screen, `useNavigate` in the agreement screen, `reduxError` and an unused `index` in the access code screen.
- **Hook dependency warnings, checked one by one.** In the login screen two effects clear the email or password error when the person types. They list only `email` or `password` on purpose: if they also listed the error, an error that arrives from the server while the field has text would be cleared at once. Each has a comment saying so and a one-line `eslint-disable`. In the access code screen the effect loads the list once when it has not been loaded yet; page and filter changes fetch on their own, so they are not dependencies (comment and disable, as in the admin screen).

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** `npx eslint src/components/Drivers`: 0 findings. `npm run build` succeeds. The whole diff was read: removed unused code and names, plus the comments. Not tested: the screens in a browser (there are no automated tests).

**Risks and follow-ups.** Low. Other folders follow as their own pull requests.

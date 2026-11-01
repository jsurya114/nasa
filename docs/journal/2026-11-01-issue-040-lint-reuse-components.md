# Lint clean-up, part 3: the shared components in reuse (issue #40)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #40 / see the pull request for this branch
- **Branch:** `chore/lint-reuse-components`
- **Type and scope:** chore(frontend)
- **Files touched:** `Frontend/src/reuse/`: `AddAdminForm.jsx`, `AddDriverForm.jsx`, `AdminsList.jsx`, `DriversList.jsx`, `Header.jsx`, `driver/Header.jsx`. **Not touched (Jasil's zone):** `UploadedData.jsx` and `TempUploadedData.jsx` in the same folder.

**What and why.** Fixes the 13 lint findings in the shared components outside Jasil's zone, with no behaviour change.
- Unused imports, state values and `dispatch` removed (`toggleAdminRole`, `accessAdminUser`, `useEffect`, `useDispatch`, `admin`, `error`, `page`, `adminsError`, `usersError`).
- `catch (error)` with an unused error is now `catch`.
- **`confirmPassword` in the two forms:** the line `const { confirmPassword, ...adminData } = form` exists to leave the confirmation field out of what is sent to the server. It cannot simply be removed, so the name is now `confirmPassword: _confirmPassword` (a leading underscore is allowed to be unused by the repository's lint rule) with a comment saying what the line does. What is sent is unchanged.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** `npx eslint src/reuse`: 0 findings in the files touched (the 4 left in the folder are in Jasil's two upload components). `npm run build` succeeds. The whole diff was read. Not tested: the screens in a browser.

**Risks and follow-ups.** Low.

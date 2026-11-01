# Frontend dependency security fixes (npm audit fix)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** none (follow-up to the dependency audit) / see the pull request for this branch
- **Branch:** `chore/frontend-npm-audit-fix`
- **Type and scope:** chore(deps)
- **Files touched:** `Frontend/package-lock.json` only. No reserved files.

**What and why.** `npm install` in `Frontend/` reported 22 known vulnerabilities (1 critical, 15 high, 5 moderate, 1 low). `npm audit fix` updated the locked versions of the affected packages inside the version ranges already allowed in `package.json` (no major upgrades, `package.json` unchanged). Direct packages affected include `vite`, `axios`, `postcss`, `react-router-dom`; the rest were indirect (for example `rollup`, `tar`, `nanoid`, `browserslist`).

**Result.** 22 findings down to 6 moderate. The 6 left are all in the ESLint tool chain (`minimatch` used by eslint and its helpers). They are development-only, are not shipped to users, and npm reports no fix available yet. They stay on the list for a later audit.

**Database.** None. **Config.** None. **Dependencies.** Lock file only; versions moved up within the existing ranges. **Money impact.** None.

**Tested.** `npm audit` before and after; `npm run build` succeeds; `npm run lint` gives the same 19 findings as before (all in Jasil's files). Not tested: clicking through the app in a browser, which the reviewer should do (login, one admin page, one driver page) since `vite`, `react-router` and `axios` were updated.

**Risks and follow-ups.** Low to medium: patch and minor updates of the build tool and router. If anything looks wrong, revert this one file. The backend has its own audit (outdated spreadsheet library is issue #25, Jasil's) and is not part of this change.

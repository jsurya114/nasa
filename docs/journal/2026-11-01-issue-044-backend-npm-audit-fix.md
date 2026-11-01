# Backend dependency security fixes (npm audit fix)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** none (follow-up to the dependency audit) / see the pull request for this branch
- **Branch:** `chore/backend-npm-audit-fix`
- **Type and scope:** chore(deps)
- **Files touched:** `Backend/package-lock.json` only. No reserved files.

**What and why.** `npm audit` in `Backend/` reported 16 known vulnerabilities (1 critical, 11 high, 4 moderate). `npm audit fix` raised the locked versions inside the ranges already allowed in `package.json`. `package.json` is unchanged and there are no major upgrades. Fixed this way: the critical `proxy-addr` finding, and `body-parser`, `qs`, `path-to-regexp`, `lodash`, `multer`, `moment`, `tmp`, `brace-expansion`, `picomatch`.

**Result.** 16 findings down to 13 (0 critical, 3 high, 10 moderate). Left on purpose:
- **`xlsx` (high, no fix exists):** replacing it is issue #25 (Jasil's zone).
- **`exceljs` and its helpers (moderate):** the fix is a major version change in the Excel code (Jasil's zone). Not touched.
- **`cloudinary`, `multer-storage-cloudinary` (high):** fixes need major upgrades of the image upload code. Needs its own pull request with an upload test.
- **`nodemon` and `minimatch` (moderate):** development tools only, not in production. The fix is a major version change.

**Database.** None. **Config.** None. **Dependencies.** Lock file only. **Money impact.** None.

**Tested.** `npm audit` before and after; `node --check` on every backend file; the server boots against a temporary test database and Redis (not the real ones) and answers requests, with no errors in its log. Not tested: logins, uploads and the Excel imports end to end, which the reviewer should try (one admin login, one driver login, one image upload). The registry integrity hashes and signatures of the frontend lock file were also checked as part of the same audit work (all match).

**Risks and follow-ups.** Low to medium: `express` helpers (`body-parser`, `qs`, `path-to-regexp`) and `multer` moved up in patch and minor versions. If anything breaks, revert this one file. Follow-ups: the cloudinary upgrade as its own pull request; the Excel libraries with Jasil (#25).

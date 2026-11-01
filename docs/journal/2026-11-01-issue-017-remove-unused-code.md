# Remove unused files, packages and commented-out code (issue #17)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #17 / see the pull request for this branch
- **Branch:** `chore/remove-unused-code`
- **Type and scope:** chore(repo)
- **Files touched:** `Backend - Shortcut.lnk` (deleted), `Backend/package.json`, `Backend/package-lock.json`, and the commented-out code in `Backend/config/db.js`, `Backend/services/driver/journeyQueries.js`, `Backend/controllers/admin/accessCodeControllers.js`, `Backend/controllers/driver/accessCodeControllers.js`, `Backend/controllers/admin/addAdminController.js`. **No reserved files** (nothing in the Excel, pay or dashboard zone).

**What and why.** Clean-up without changing behaviour:
- Deleted the committed Windows shortcut `Backend - Shortcut.lnk` (it only works on one person's computer).
- Removed four packages nobody imports: `body-parser` (Express 5 has its own built in and the code uses `express.json`), `sequelize`, `sequelize-cli` and `string-similarity`. Checked again first, as the issue asked: a scan of every source file in `Backend/` (ignoring commented lines) finds no live import of any of them, and no script, config file or `.sequelizerc` uses them. The lock file lost only the lines of those packages and what only they needed (997 lines removed, none added; no other version changed).
- Removed 51 lines of commented-out code: an old copy of `checkSequenceConflict`, an old `updateSeqRouteCodeToDeliveriesTable`, a database connection test in `db.js`, two unused access-code format checks, and a log line for superadmin creation. Explanations, section headings and usage notes in comments were kept.

**Left alone on purpose (Jasil's zone or in flux).**
- Commented-out code in `weeklyUploadsController.js` (about 240 lines), `fileUploadsController.js` and `utils/matchFns.js`. For Jasil to clear when he is ready.
- `xlsx-populate`: no live import (only a commented one in `fileUploadsController.js`), but Jasil is replacing Excel libraries, so it is his to remove.
- `utils/matchFns.js` and `utils/excelHelperFns.js` are imported by nothing. `excelHelperFns.js` also calls `stringSimilarity` without importing it, so its fuzzy match would fail if anyone called it. Because nothing calls it, removing `string-similarity` changes nothing. Worth deleting both files; for Jasil to decide.

**Database.** None. **Config.** None. **Money impact.** None: no pay, rate or Excel code touched.

**Merge note (from the issue).** Backend dependency files may also change in Jasil's library replacement. Whoever merges second runs `npm install` and commits the regenerated lock file.

**Tested.**
- Backend starts (database connects, "Server running"), and a login with no body, an unknown address and a route without a token answer 500 / 404 / 401 exactly as on `develop` without this change. (The 500 on a login with no body was already there: the handler reads `req.body.email` when no body was sent. Worth a small validation fix later.)
- The same backend also starts on `develop` with these four packages removed from `node_modules`, so nothing depends on them.
- `node --check` passes on every edited file; the frontend builds (`npm run build`).
- Not tested: the production host, a full manual run of the screens.

**Risks and follow-ups.** None known. Removing the packages shrinks installs and removes their audit warnings.

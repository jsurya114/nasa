# Move SQL out of controllers, part 1: the driver language controller (issue #19)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #19 / see the pull request for this branch
- **Branch:** `refactor/sql-language-controller`
- **Type and scope:** refactor(drivers)
- **Files touched:** `Backend/controllers/driver/languageController.js`, `Backend/services/driver/languageQueries.js` (new). No reserved files.

**What and why.** The engineering standard says controllers read the request and call a service, and services hold all SQL. This controller ran two queries itself (read and save a driver's preferred language). They moved, word for word, into `languageQueries.getPreferredLanguage` and `languageQueries.updatePreferredLanguage`. The controller now calls them and no longer imports the database pool. The queries, the answers, the status codes and the messages are unchanged.

**Database.** None (the same two statements). **Config and dependencies.** None. **Money impact.** None.

**Tested.** A throwaway script (not committed) ran the old controller (from `develop`) and the new one on the same seeded Postgres, 12 requests each: read an existing driver, one with no stored language, a missing driver, no id, a non-numeric id; save a valid language twice, an invalid language, a missing driver, an empty body, a non-numeric id; read again. Every answer (status and body) was identical, and the `drivers` table was identical afterwards. Not tested: the app screens.

**Risks and follow-ups.** None. The other controllers of issue #19 follow as their own pull requests; the Excel, pay, dashboard and analytics controllers are Jasil's.

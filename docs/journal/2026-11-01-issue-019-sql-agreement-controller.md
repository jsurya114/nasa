# Move SQL out of controllers, part 3: the admin agreements controller (issue #19)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #19 / see the pull request for this branch
- **Branch:** `refactor/sql-agreement-controller`
- **Type and scope:** refactor(agreements)
- **Files touched:** `Backend/controllers/admin/agreementController.js`, `Backend/services/admin/agreementQueries.js` (new). No reserved files.

**What and why.** The admin agreements controller ran two queries itself: the list of drivers with their agreement status (filtered by the admin's cities) and the revoke or mark-as-signed update. They moved, word for word, into `agreementQueries.getAgreementsForAdmin` and `agreementQueries.setAgreementStatus`. The controller keeps the checks that belong to it (who the admin is, a valid driver id, the city check) and no longer imports the database pool. The city rules from issue #12 are unchanged.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** A throwaway script (not committed) ran the old controller (from `develop`) and the new one on the same seeded Postgres: revoke and mark as signed as admin and as superadmin, a missing driver, the list for a city admin, an admin with no cities and a superadmin. Same status codes and bodies, and the `drivers` table was identical row for row afterwards (the signed-at time compared as "just now", since the database clock sets it). The city rules still hold: a driver in another city, a driver with no city and an admin with no cities all get 403 with the table unchanged; bad ids (`abc`, `1abc`, `0x1`, `1e0`, `-1`, `0`, `1.5`, empty) get 400. 24 checks, all passed. Not tested: the admin screen.

**Risks and follow-ups.** None.

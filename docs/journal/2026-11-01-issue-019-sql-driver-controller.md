# Move SQL out of controllers, part 2: the driver controller (issue #19)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #19 / see the pull request for this branch
- **Branch:** `refactor/sql-driver-controller`
- **Type and scope:** refactor(drivers)
- **Files touched:** `Backend/controllers/driver/driverController.js`, `Backend/services/driver/loginQueries.js`, `Backend/services/driver/agreementQueries.js` (new). No reserved files.

**What and why.** The driver controller ran two queries itself: saving the driver's timezone at sign-in, and marking the agreement as signed. They moved, word for word, into `loginService.updateTimezone` and `agreementQueries.signAgreement`. The controller no longer imports the database pool. Same queries, same answers.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** A throwaway script (not committed) ran the old controller (from `develop`) and the new one on the same seeded Postgres: sign in with the right password, a wrong password, an unknown address, no timezone, a blocked account, a second driver; sign the agreement for a driver, with a missing date, for a driver that does not exist, and with a date that is not a date. Every status and body was identical (tokens are masked since they differ every time), and the stored timezones and agreement fields (signed flag, signature name, joining date, whether the signed time was set) were identical afterwards. Not tested: the app screens.

**Risks and follow-ups.** None.

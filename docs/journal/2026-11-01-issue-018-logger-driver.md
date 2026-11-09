# One small logger, part 3: the driver module (issue #18)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #18 / see the pull request for this branch
- **Branch:** `refactor/logger-driver`
- **Type and scope:** refactor(drivers)
- **Files touched:** driver controllers `driverController`, `accessCodeControllers`, `journeyController`, `languageController`, `deliveryController`, `updatepasswordController`, and driver services `journeyQueries`, `updatepasswordQueries`, `accessCodeQueries`, `routeQueries` (all under `Backend/controllers/driver` and `Backend/services/driver`). No reserved files.
- **Needs first:** part 1 (`Backend/utils/logger.js`). Until it is merged this pull request also shows that commit.

**What and why.** 32 `console` calls in the driver module now use the logger.
- Errors are logged as `logger.error('<what failed>', error)`: the logger keeps the error's name, message and code and drops everything else attached to it.
- Logs that were translated into the driver's language (delivery, password, language, timezone) are now fixed English messages, so logs read the same whatever language the app is in.
- Two lines that printed data are now counts: the failed Cloudinary uploads (file objects with names) and the uploaded image links.
- Two bare `console.error(error.message)` calls now say which handler failed (driver login, get driver).
- "Driver timezone updated" and "language updated" are level `debug` (they happen on every login), and the "Toggled route" debug line keeps only the route id.

**Not changed.** What the code does. Same queries, same answers.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** A throwaway script (not committed) ran the real driver handlers with a temporary Postgres at level `debug`: login (right and wrong password, no body), refresh with a bad token, language update, password update (right and wrong old password), journey save, access code list and create, delivery summary. Their answers are the same as before this change (some handlers answered 500 in the script only because its throw-away tables lack columns the real database has). The log contains no password, token, email, driver name, gate code or street address, no emoji and no banners. The earlier journey, role and self-access suites still pass. Not tested: the production host.

**Risks and follow-ups.** None known.

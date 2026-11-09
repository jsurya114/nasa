# One small logger, part 4: the admin module (issue #18)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #18 / see the pull request for this branch
- **Branch:** `refactor/logger-admin`
- **Type and scope:** refactor(admins)
- **Files touched:** admin controllers `accessCodeControllers`, `addUserController`, `addAdminController`, `adminController`, `adminJourneyController`, `agreementController`, `jobController`, `routeController`, and admin services `accessCodeQueries`, `dbQueries`, `jobQueries`, `routeQueries` (under `Backend/controllers/admin` and `Backend/services/admin`). No reserved files.
- **Needs first:** part 1 (`Backend/utils/logger.js`). Until it is merged this pull request also shows that commit.

**What and why.** 58 `console` calls now use the logger.
- Errors: `logger.error('<what failed>', error)`; only the error's name, message and code are kept.
- Emoji and trailing colons are gone from the messages, and the separate "Stack:" line in `routePagination` is dropped (the logger prints a stack only at level `debug`).
- Two bare `console.error(err.message)` calls now name the handler ("Error changing driver status", "getUser failed"). A line that reported an insert failure with `console.log` is now an error.
- Detail that printed data is trimmed: "City updated" keeps only the city id (it printed the whole row), the update-city query no longer prints its SQL and parameters, and its result keeps only the id. The driver-city lines print `{ driverId, cityType }` as fields.
- Chatter that happens on every request is level `debug`.

**Left as is.** `controllers/admin/dashController.js` (3 calls) feeds the dashboard screens, so it is left for Jasil, as are the Excel, pay, dashboard and analytics files.

**Not changed.** What the code does.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** Throwaway scripts (not committed) with the real handlers and a temporary Postgres at level `debug`: the drivers, journeys, agreements, access codes and cities suites from issue #12 all pass with the same answers as before. The logger lines they produce are error lines such as "Access code not found" and contain no email, name or code. The routes suite shows four failures that are a stale test: it was written when deleting a route removed the row, and since routes are now archived the row stays. The same four fail on the branch without this change, so they are not caused by it; archiving is covered by its own checks (issue #13). Not tested: the production host.

**Risks and follow-ups.** None known.

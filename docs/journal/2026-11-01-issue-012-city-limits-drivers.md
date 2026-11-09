# Admin city limits: drivers module (issue #12, part 1)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #12 / see the pull request for this branch
- **Branch:** `fix/admin-city-drivers`
- **Type and scope:** fix(drivers)
- **Files touched:** `Backend/services/admin/cityAccess.js` (new), `Backend/controllers/admin/addUserController.js`. No reserved files.

**What and why.** An admin should act only on drivers in the cities assigned to them. The driver list already followed this rule. The three actions that change a driver did not: create, switch on/off, and edit. They now check the assigned cities, and refuse with 403 and a clear message when the driver, or the city a driver is created in or moved to, is outside them. A superadmin may act in every city. A driver with no city can be changed by a superadmin only. A missing driver answers 404.

A small shared helper, `cityAccess.js`, answers "may this admin act in this city / on this driver?" from the verified token and `admin_city_ref`. The next modules in this issue (routes, journeys, cities, agreements, availability) reuse it, one pull request each.

**Database.** None. Reads `admin_city_ref`, `city` and `drivers` with query parameters only.

**Config and dependencies.** None.

**Money impact.** None. No pay, rate or Excel file was touched.

**Tested.** A throwaway script (not committed) ran the real handlers against a temporary local Postgres with a minimal copy of the tables (16 checks, all passed): an admin can create, switch and edit drivers in their own city; is refused for a driver or city outside theirs (nothing is written, city unchanged), for a driver with no city, and for an unknown city; missing driver gives 404; a superadmin can do all of it. Not tested: the admin screens in a browser, and the production database.

**Risks and follow-ups.**
- An admin with no assigned city can no longer create or edit drivers. That is intended. If a real admin is in that state they need a city assigned by a superadmin.
- Remaining modules for this issue: routes, journeys, cities, agreements, availability, access codes. Access codes have no city column, so they need a schema decision first; that goes in its own pull request.

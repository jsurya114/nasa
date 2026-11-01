# Admin city limits: routes module (issue #12, part 2)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #12 / see the pull request for this branch
- **Branch:** `fix/admin-city-routes`
- **Type and scope:** fix(routes)
- **Files touched:** `Backend/services/admin/routeAccess.js` (new), `Backend/controllers/admin/routeController.js`. No reserved files (the dashboard "routes by city" endpoint belongs to Jasil and was not touched).

**What and why.** An admin should act only on routes in the cities assigned to them. The route lists already followed this rule. The actions that work on one route did not. Reading one route, editing, switching on/off and deleting now refuse with 403 when the route is outside the admin's cities. Editing also checks the city a route is moved to. The "routes of a driver" call refuses when the driver is outside the admin's cities. A superadmin may act in every city. A missing route answers 404. Creating a route was already superadmin-only.

A route belongs to a city through its job name. The checks read the verified token and `admin_city_ref`, with query parameters only.

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None. Route prices are not changed by this pull request. Only who may edit them is limited.

**Tested.** A throwaway script (not committed) ran the real handlers against a temporary local Postgres with a minimal copy of the tables (18 checks, all passed): an admin can read, edit, switch and delete routes in their own city; is refused with the row unchanged for another city, including moving a route out of or into their cities; the driver-routes call is refused for a driver in another city and returns no data; missing route gives 404; a superadmin can do all of it. Not tested: the screens in a browser, and the production database.

**Risks and follow-ups.**
- `routeAccess.js` repeats two small checks that `cityAccess.js` (drivers pull request) also has, because the two pull requests were made independently so neither waits for the other. A later `refactor` pull request should merge them into one file.
- Deleting a route is still a hard delete. Issue #13 changes that in stages.

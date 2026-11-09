# Admin city limits: cities module (issue #12, part 6)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #12 / see the pull request for this branch
- **Branch:** `fix/admin-city-cities`
- **Type and scope:** fix(cities)
- **Files touched:** `Backend/controllers/admin/jobController.js`, `Backend/services/admin/jobQueries.js`. No reserved files.

**What and why.** The cities module was reviewed action by action:
- Adding a city, editing a city and switching a city on or off already need a superadmin.
- The paginated city list and `get-admin-cities` already show a city admin only their own cities.
- **`get-cities` returned every enabled city to every admin.** It now returns every enabled city to a superadmin and only the admin's own enabled cities to other admins. No screen in the app calls it today, so nothing visible changes; this closes the open call.

**Database.** None. A new read query with a query parameter.

**Config and dependencies.** None.

**Money impact.** None.

**Tested.** A throwaway script (not committed) used the real admin router and token checks, a real local Redis and a temporary local Postgres with a minimal copy of the tables (9 checks, all passed): a city admin gets only their own enabled city (a disabled assigned city is left out, as in the other list); an admin with no cities gets an empty list; a superadmin gets every enabled city; `get-admin-cities` and the paginated list still show only own cities; a city admin cannot add, edit or switch a city (403, nothing changed). Not tested: the admin screens in a browser, and the production database.

**Risks and follow-ups.** If a screen is later built on `get-cities` it will show city admins only their own cities, which is the intended rule.

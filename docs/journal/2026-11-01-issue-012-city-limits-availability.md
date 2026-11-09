# Admin city limits: availability module (issue #12, part 5)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #12 / see the pull request for this branch
- **Branch:** `fix/admin-city-availability`
- **Type and scope:** fix(availability)
- **Files touched:** `Backend/routes/adminRoutes.js` (one line). No reserved files.

**What and why.** The availability screen was reviewed action by action:
- Listing drivers, the day counts and the city dropdown already filter by the admin's assigned cities.
- Editing one driver's availability already checks the admin's cities in the query itself and refuses outside them (404 "not found or access denied").
- **"Reset availability for ALL drivers" was open to every admin.** The comment and the screen say superadmin only (the button is only shown to superadmins) but the route had no check, so a city admin could clear the availability of every driver in every city. The route now needs a superadmin (403 for other admins).

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None.

**Tested.** A throwaway script (not committed) used the real admin router, real login-token checks, a real local Redis and a temporary local Postgres with a minimal copy of the tables:
- Before the change a city admin got 200 and every driver was reset. After it: 403 and nothing changes.
- A driver token and a call with no token are refused. A superadmin still gets 200 and all drivers are reset.
- Editing a driver's availability in another city is refused and not changed; in the admin's own city it works (200).
Not tested: the admin screen in a browser, and the production database.

**Risks and follow-ups.** A city admin who used the reset call directly (the screen does not show it to them) now gets 403. The cron job that resets availability on schedule is not affected.

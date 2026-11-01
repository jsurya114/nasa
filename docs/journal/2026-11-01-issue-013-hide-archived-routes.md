# Archive routes, step 3: hide archived routes from lists and dropdowns (issue #13)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #13 / see the pull request for this branch
- **Branch:** `chore/routes-hide-archived`
- **Type and scope:** chore(routes)
- **Files touched:** `Backend/services/admin/routeQueries.js`. No reserved files; no dashboard, payment, analytics or Excel file was touched.
- **Needs first:** the migration from step 2 (`routes.deleted_at`) must already be run on the database. Without the column these queries fail. Nothing is archived yet, so lists look exactly as before.

**What and why.** Step 4 will make "delete route" mark a route as archived instead of removing it. This step teaches the route lists to skip archived routes first, so step 4 does not change what anyone sees on release day. Every list that offers routes to choose or manage now adds `deleted_at IS NULL`:
- the route list screen (all eight filter combinations, for superadmins and for city admins, including the page counts);
- the routes dropdown for admins (`routes-list`), for one driver (`routes-by-driver`) and the routes a driver is shown for their own city.

Left as they were on purpose (the issue's contract): everything that reads past records. The dashboard, payment, analytics and Excel queries, the journey lists and the driver's delivery history still join routes by id, so an archived route keeps showing on old records. Reading, editing or switching one route by its id is also unchanged in this step (step 4 decides what is allowed on an archived route).

**Database.** None in this pull request (it needs the step 2 column). 

**Config and dependencies.** None.

**Money impact.** None. No pay, rate or Excel file was touched, and nothing is archived yet.

**Tested.** A throwaway script (not committed) ran the old queries (from `develop`) and the new ones on a temporary local Postgres that has the column. With nothing archived, every result was identical to the old code: five queries plus all eight list variants (superadmin and city admin, with and without search and city filter), including the page counts. After archiving two routes, none of them appears in any list or count, the other routes still do, and a read by id still finds an archived route. Not tested: the screens in a browser, the real database.

**Risks and follow-ups.**
- Release only after the step 2 migration is on the real database, otherwise route lists fail.
- Not changed here: the dashboard filter dropdowns (`dashboardService`) still list archived routes, which matches the contract. If the owner wants archived routes hidden there too, that is a request for Jasil, who owns the dashboard.
- `Backend/services/driver/routeQueries.js` is an unused copy of the admin route queries and was not touched.

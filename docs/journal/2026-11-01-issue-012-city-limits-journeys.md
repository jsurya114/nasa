# Admin city limits: journeys module (issue #12, part 3)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #12 / see the pull request for this branch
- **Branch:** `fix/admin-city-journeys`
- **Type and scope:** fix(journeys)
- **Files touched:** `Backend/services/admin/journeyAccess.js` (new), `Backend/controllers/admin/adminJourneyController.js`. Reserved files: none. The journey records live in the same table the dashboard reads (`dashboard_data`), so the change was made as checks that run before the existing code and do not alter any query or calculation.

**What and why.** An admin should act only on journeys in the cities assigned to them. The journey lists already followed this rule through the driver's city. Adding, editing and deleting a journey did not. Now:
- Adding a journey needs both the driver and the route to be in one of the admin's cities.
- Editing needs the journey's current driver, and the driver and route it is changed to, to be in the admin's cities.
- Deleting needs the journey's driver to be in the admin's cities.
Otherwise the answer is 403 and nothing is written. A superadmin may act in every city. The "missing journey" (404) and "missing driver" (400) answers are unchanged.

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None. The change only adds checks before the existing code. It adds 23 lines and removes none, so the queries that write journeys and deliveries, the sequence-overlap check and the delivery sync are untouched. No Excel, payment or dashboard file was edited. To prove it, the old controller (from `develop`) and the new one were run on the same starting data with the same allowed actions (add, edit, delete, as admin and as superadmin). The `dashboard_data` and `deliveries` tables came out identical, row for row, and every answer code was the same.

**Tested.** Throwaway scripts (not committed) on a temporary local Postgres with a minimal copy of the tables (15 checks, all passed): the old-versus-new comparison above, and for an admin: add for a driver or a route in another city, edit a journey in another city, move own journey to a driver or route in another city, pull another city's journey into their own, and delete another city's journey are all 403 with `dashboard_data` and `deliveries` unchanged; missing journey 404; missing driver 400.

**Not tested:** the real database. The test database has no pay triggers (production has triggers on `dashboard_data` that fill the payment table; they are not stored in this repository), so payment amounts were not run. They cannot be affected by this change because the statements that fire those triggers are unchanged and run only after the new checks pass, with the same values as before. The admin screens in a browser were not tested.

**Risks and follow-ups.**
- A journey is tied to its driver's city, as in the lists. A route in another city is refused on add and edit as well.
- `journeyAccess.js` repeats small checks that the drivers and routes pull requests also have, so the three can be merged in any order. A later `refactor` pull request should merge them into one file.

# Move SQL out of controllers, part 4: the admin journey controller (issue #19)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #19 / see the pull request for this branch
- **Branch:** `refactor/sql-admin-journey-controller`
- **Type and scope:** refactor(journeys)
- **Files touched:** `Backend/controllers/admin/adminJourneyController.js`, `Backend/services/admin/AjourneyQuery.js`. No reserved files. The journey records live in the table the dashboard reads, so the change was kept to moving one read query unchanged; no write, calculation or Excel file was touched.

**What and why.** When an admin edits a journey, the controller looked up the journey's date with a query of its own. That query moved, word for word, into `AdminJourneyQuery.getJourneyDateById` (next to the other journey queries). The controller calls it and no longer imports the database pool. All the writes already lived in the service.

**Database.** None. **Config and dependencies.** None. **Money impact.** None: the add, edit and delete statements that write journeys and deliveries are untouched.

**Tested.** The journey suite from issue #12 (throwaway script, not committed) runs the old controller (from `develop`) and the new one on the same seeded Postgres: add, edit and delete as admin and as superadmin gave the same answers and identical `dashboard_data` and `deliveries` rows. The city rules still hold (another city's driver, route or journey gets 403 with the tables unchanged), a missing journey is 404, a missing driver is 400, and bad ids (`abc`, `1abc`, `0x2`, `1e0`, `-1`, `0`, `1.5`, empty) are 400 with nothing changed. 32 checks, all passed. Not tested: the admin screen, and the production pay triggers (not in the repository).

**Risks and follow-ups.** None.

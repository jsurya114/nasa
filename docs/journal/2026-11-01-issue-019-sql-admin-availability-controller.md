# Move SQL out of controllers, part 6: the admin availability controller (issue #19)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #19 / see the pull request for this branch
- **Branch:** `refactor/sql-admin-availability-controller`
- **Type and scope:** refactor(availability)
- **Files touched:** `Backend/controllers/admin/adminavailabilityController.js`. No reserved files.
- **Builds on:** the driver availability pull request, which adds `availabilityService.getDriverTimezone`. Until that is merged this pull request also shows that commit.

**What and why.** When an admin edits a driver's availability, the controller read the driver's timezone with a query of its own. It now calls `availabilityService.getDriverTimezone`, the same function the driver controller uses (added in the previous pull request, word for word from the old query). The controller no longer imports the database pool. This was the last controller outside the Excel, pay, dashboard and analytics zone that ran SQL.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** A throwaway script (not committed) ran the old controller (from `develop`) and the new one on the same seeded Postgres with two cities and drivers in three timezones: the admin list, the city dropdown, the counts, updates as an admin (own city, a driver in another city, a missing driver, a non-numeric id, a bad value) and as a superadmin, the list again, and the reset of all drivers. Every status and body was identical (saved time masked), and the stored availability of all drivers was identical afterwards. The city rules from issue #12 still hold. Not tested: the admin screen.

**Risks and follow-ups.** None. The remaining controllers that run SQL (`fileUploadsController`, `weeklyUploadsController`, `analyticsController`, and `dashController`/dashboard files) are in Jasil's zone.

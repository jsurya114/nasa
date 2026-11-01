# Move SQL out of controllers, part 5: the driver availability controller (issue #19)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #19 / see the pull request for this branch
- **Branch:** `refactor/sql-driver-availability-controller`
- **Type and scope:** refactor(availability)
- **Files touched:** `Backend/controllers/driver/driveravailabilityController.js`, `Backend/services/driver/availabilityQuery.js`. No reserved files.

**What and why.** When a driver updates their availability, the controller first read the driver's stored timezone with a query of its own. That query moved, word for word, into `availabilityService.getDriverTimezone`, which the admin availability controller will use too (next pull request). The controller no longer imports the database pool.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** A throwaway script (not committed) ran the old controller (from `develop`) and the new one on the same seeded Postgres with drivers in three timezones: read availability of two drivers and of a missing one; update availability with all true and all false, for a driver whose rules block the change (the 403 depends on the day in their timezone), for a missing driver, with a bad value and with no body; read again. Every status and body was identical (the saved time masked), and the stored availability of all drivers was identical afterwards. Not tested: the driver app screens.

**Risks and follow-ups.** None.

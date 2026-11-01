# One wrapper instead of repeated try/catch, part 2: the city controller (issue #20)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #20 / see the pull request for this branch
- **Branch:** `refactor/async-handler-jobs`
- **Type and scope:** refactor(cities)
- **Files touched:** `Backend/controllers/admin/jobController.js`. No reserved files.
- **Builds on:** part 1, which adds `Backend/utils/asyncHandler.js`. Until it is merged this pull request also shows that commit.

**What and why.** The eight city handlers (list, add, update, delete, switch on/off, paginated list, cities for dropdowns, and the driver's city type) each had their own try/catch. They now use `asyncHandler`, with the answer each catch block sent copied as it was. Bodies are unchanged apart from one less indent level (review with `?w=1`).

One visible difference in the logs only: six of these handlers never logged an error in their catch block, they only sent the answer. The wrapper always logs, so those six now also log `<handler> error` with the error's name and message (through the shared logger, which hides sensitive values). The answers are unchanged.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** A throwaway script (not committed) called the old controller (from `develop`) and the new one side by side: (a) with the database failing, each of the eight handlers as an admin and a superadmin returned the identical status and body (16 comparisons); (b) on a seeded Postgres, 21 requests (list, add with a good body, empty name, empty code, disabled, a wrong city type and a duplicate; update with a good body, a missing city and a wrong type; switch on/off and delete for found and missing cities; paginated list as superadmin and admin with search and status; cities for dropdowns; the driver's city type for a daily, a weekly and a missing driver) returned identical statuses and bodies, and the stored cities were identical afterwards. 39 checks, all passed. Not tested: the screens.

**Risks and follow-ups.** None known.

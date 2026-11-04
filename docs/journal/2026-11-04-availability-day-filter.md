# Availability: choosing a day shows only that day

- **Date:** 2026-11-04
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** none (requested in chat) / see the pull request for this branch (it contains #204's one commit until that merges)
- **Branch:** `fix/availability-show-selected-day` (from `fix/remove-node-modules-link`, which is `develop` plus #204)
- **Type and scope:** fix(availability), frontend only
- **Files touched:** `Frontend/src/components/Admin/AdminDriverAvailability.jsx`, new test `AdminDriverAvailability.day.test.jsx`. No reserved file.

**What changed.** On the admin availability screen, when a day is chosen in the Day filter the list already held only the drivers available that day (the server filters on it). The table (header and each driver's cells) and the phone cards still showed all seven days for those drivers. They now show only the chosen day. "All Days" brings the whole week back. While a driver is being edited every day is shown again, so editing works exactly as before (Edit and Cancel put the single day back).

**Nothing else changed.** The request to the server, the counts, the status filter, the day locking, saving and the summary cards above the list are as they were.

**Tested.** Vitest with a fake server that filters like the real one (1 test): the whole week shows with no day; choosing Tuesday lists only the drivers available on Tuesday and shows only Tue; Edit shows all days, Cancel returns to Tue; Monday lists only Monday's drivers; All Days restores everyone and the week. Showing all days always fails it, and showing one day while editing fails it (checked). Frontend suite passes (232 tests), the changed files are lint-clean.

**Not tested.** Not looked at in a browser; the phone cards were not looked at either. The "Unavailable on <day>" status choice combined with a day still returns nothing (the server only returns that day's available drivers); that is how it already worked.

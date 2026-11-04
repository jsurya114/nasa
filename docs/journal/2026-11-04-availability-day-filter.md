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

**Alignment check (real browser, made-up data).** With one day shown, the day button sat at the left of the wide column instead of under the centred day heading (a flex button is not centred by `text-center`). Both the desktop cell and the phone card button now have `mx-auto`. Measured after the change: at 1440 px the button centres equal the heading centre for one day and for all seven days, and at 390 px the phone card button is centred with no sideways scroll.

**Not tested.** Not looked at on the real data or the live page (the preview used a made-up list with the real component and styles); Edit mode was not looked at in the browser. The "Unavailable on <day>" status choice combined with a day still returns nothing (the server only returns that day's available drivers); that is how it already worked.

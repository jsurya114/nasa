# Daily upload: find each driver by the name in the file (behind a switch)

| Field | Value |
|---|---|
| Date | 2026-11-26 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR) |
| Branch | `feat/daily-match-by-name` (from `develop`) |
| Type / scope | `feat(excel)` |
| Files touched | Backend: `migrations/2026-11-26-daily-match-by-name.sql` + `.rollback.sql` (new), `services/admin/dailyByName/` (new: `planDailyDrivers.js`, `dailyByNameStore.js`, `summarizeDailyPlan.js`, `dailyChoices.js`), `controllers/admin/dailyMatchController.js` (new), `controllers/admin/fileUploadsController.js`, `services/admin/excelFileQueries.js`, `routes/adminRoutes.js`, `.env.example`, tests `planDailyDrivers.test.js`, `dailyByNameStore.test.js` (new). Frontend: `components/Admin/dailyMatching/` (new page, result panel, API, tests), `App.jsx`, `reuse/Nav.jsx`. This entry. |
| Reserved files touched | `fileUploadsController` and `excelFileQueries` (Jasil gave his OK on Slack, 26 Nov 2026). `DoubleStop.jsx` is **not** changed: showing the result panel on the upload page needs two lines there and Jasil's OK. |

**What and why.** Today admins (or drivers) type each driver's route and sequence range every day, and the daily file is matched to those ranges. The file already names the driver on every row. With `DAILY_MATCH_BY_NAME=true` the upload makes each driver's day from the file: the driver is the row's `DriverName` (a remembered match for that name in the city first, else a driver of that city with the same name, compared like the app compares names: case, spaces, NFC), the route is the file route without the day prefix and without a `-T-<n>` transfer suffix. Then the usual steps (match, classify, first stop and double stop, counts) run unchanged. With the switch off nothing changes.

**Decisions (Jasil, Slack 26 Nov).**
- **Sub-routes:** a driver can be given a sub-route of a main route (it sets the price). Stored per city, main route and driver, with who and when; admins see, change and undo it on the new "Daily drivers" page. Without one, the driver is on the main route's price, and each upload lists the drivers paid at the main price on a main route that has a sub-route with another price.
- **Pre-fill** (in the migration): from the last 28 days, a driver who was on exactly one sub-route of a main route and never on that main route itself. Read-only preview on production: 2 drivers (driver ids 223 → `DFW 036-1:B`, 367 → `DFW 053 A-1:B`; both sub-routes have the main route's prices). Nobody else is guessed. Only one sub-route has another price today (`DFW 024-1:E`, DS 0.50); nobody used it in the last 4 weeks.
- **Remembered names:** "this file name = this driver", per city, with who and when, undo on the same page.

**Answers to the review points.**
- *Duplicates:* one delivery per route, sequence and day, as before (a database unique index). A sequence a driver has twice counts once, as in the old method. When the file gives two drivers the same sequences on one main route (SpeedX does this; admins used `:B` for it), the later driver goes to a sub-route with the same prices that is free for those numbers, so pay is the same; if none is free their rows are not added and are listed. A row that is not placed can never take a placed driver's code.
- *Re-upload:* a day that exists and is not paid gets the new sequences added (the database fills a widened range with placeholder rows; they are removed again), then everything is counted again as the upload always does. A paid day is never changed; its rows are counted and listed.
- *Nothing skipped silently:* the result counts every row once: added to a driver, paid day, name not matched, driver disabled, same sequence as another driver, route not in the app / disabled / without a city, could not be read. It also lists unmatched names with parcel counts and a link to match them.
- *Memory:* no new workbook opening; the daily upload still reads the file once, as before.

**Proof (6 Nov 2026 Dallas file).** The new method ran on the local copy inside a rolled-back transaction, with production's current Dallas drivers and routes loaded into that transaction only, and was compared with production's stored old results for that day (read-only). 15 file names are written differently from the app; they were matched once from that day's entries, as an admin would. Result: **39 of 43 drivers equal to the cent** (first stops, double stops, delivered, failed, pay). The 4 others:
- 1 driver has since been disabled in the app: their 78 rows are listed as "driver disabled" instead of paid ($115.70 on that day).
- 3 drivers on `DFW 041 B-1`: the file gives them 0–120, 121–280 and 290–441; the hand entry was 1–130, 131–280, 291–441, so the old method gave 121–130 to the wrong driver and never paid 0 and 290. The new method follows the file (+$3.20 for the three together).
- The `DFW 053 A-1` pair (both on 1–100) is equal to the cent: the second driver went to `:A` (same prices as the main route) instead of the `:B` used by hand.
- "No scan" counts are lower in the new method (old 166, new 59): the old ranges included sequences that are not in the file; those were counted as no scan. No scan is not paid.

**Database.** New tables `daily_name_matches` and `daily_subroute_choices` and the pre-fill; exact SQL in `Backend/migrations/2026-11-26-daily-match-by-name.sql`, rollback in the `.rollback.sql` next to it. Back up first, run on a copy first, then before deploying. Ran twice on the local copy (safe to re-run).

**Config and dependencies.** New switch `DAILY_MATCH_BY_NAME` (off unless exactly `true`). No new dependency.

**Money impact.** None while the switch is off. With it on: as in the proof above.

**Tested.** Backend suite 373 passed (DB tests skipped without a database); planner tests (9) and the DB test (days created from the file, sub-route moves, re-upload, paid day, the choices and their checks) pass on the local copy. Frontend suite passes, with tests for the result panel. The proof above. **Not tested:** more than one day (only the 6 Nov daily file is available; Jasil asked for several days, which needs more daily files); the result panel on the upload page (needs the `DoubleStop.jsx` OK); a city admin's view; production.

**Risks and follow-ups.** Wire the result panel into the upload page (needs OK). Run the proof on more days. Removing the hand entry of routes and sequences is a separate later PR, after the cutover.

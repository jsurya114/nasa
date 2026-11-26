# Daily by name: rebuild the file's days on re-upload, never pay a parcel twice

| Field | Value |
|---|---|
| Date | 2026-11-26 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR); fixes #343 |
| Branch | `fix/daily-rebuild-file-days` (from `develop`) |
| Type / scope | `fix(excel)` |
| Files touched | `Backend/migrations/2026-11-26-daily-file-days.sql` + `.rollback.sql` (new), `Backend/services/admin/dailyByName/dailyByNameStore.js`, `planDailyDrivers.js`, `summarizeDailyPlan.js`, `Backend/controllers/admin/fileUploadsController.js`, tests `planDailyDrivers.test.js`, `dailyByNameStore.test.js`; `Frontend/src/components/Admin/dailyMatching/DailyByNameResult.jsx`, `DailyMatching.jsx`, `DailyByNameResult.test.jsx`, this entry. |
| Reserved files touched | `fileUploadsController` (Jasil's OK for this work, Slack 26 Nov 2026). |

**What and why.** Found while testing `develop` on the mock server (switch on; it is off in production):
1. **The same parcels could be paid to two drivers.** A name matched to the wrong driver, uploaded, then corrected and uploaded again: the wrong driver kept the day, and the right driver got a new day on a same-price sub-route for the same 170 parcels. Fix: the days the file makes are now remembered (`daily_file_days`); every upload of a day first removes those days (on the file's routes) and makes them again from the file. Never removed: a day entered by hand, a paid day, a day in a pay statement, a day matched to a carrier statement. In addition, a parcel (main route + sequence) that is already in another driver's day which the file no longer gives it to is never given to a second driver on any route: that driver is listed under "same sequences as another driver" instead. A driver who already has a day keeps its route.
2. **A driver's name was in the page address.** The result's "Match" link now hands the city and the name to the Daily drivers page in page state, so the name is not kept in browser history or a server log.

**Database.** New table `daily_file_days (dashboard_data_id → dashboard_data ON DELETE CASCADE, journey_date)`. Exact SQL and rollback in the two migration files. Back up first; run after `2026-11-26-daily-match-by-name.sql` and before deploying. Ran forward, back and forward on the local copy and on the mock.

**Config and dependencies.** None. **Money impact.** None with the switch off. With it on: the 6 Nov proof is unchanged (39 of 43 drivers equal to the cent, the other 4 explained in the #343 entry), and a corrected name no longer pays a parcel twice.

**Tested.** Backend suite 378 passed; planner tests 11 (new: every same-price sub-route taken, a parcel held by another driver's day, a driver keeps their own day's route); DB test with the exact scenario (wrong match, upload, correct, upload: the parcels move; paid day never rebuilt, nobody else gets its parcels). Frontend suite 651 passed (new: the Match link carries the name in state, not the address). On the mock server (production limits, switch on): wrong match, upload, corrected match, upload again: 28 days rebuilt, the 170 parcels moved to the right driver, the wrong driver's day gone, totals unchanged (28 days, 3,055 parcels, one delivery each). **Not tested:** production.

**Risks and follow-ups.** Showing the result panel on the upload page still needs two lines in `DoubleStop.jsx` (asked Jasil).

# Upload page: show what the daily upload did with every row

| Field | Value |
|---|---|
| Date | 2026-11-26 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR); follows #343 and #344 |
| Branch | `feat/daily-by-name-result-panel` (from `develop`) |
| Type / scope | `feat(ui)` |
| Files touched | `Frontend/src/components/Admin/DoubleStop.jsx`, `Frontend/src/components/Admin/DoubleStop.dailyByName.test.jsx` (new), this entry. |
| Reserved files touched | `DoubleStop.jsx`: Jasil gave his OK on Slack (26 Nov 2026) for these lines, as their own PR. |

**What and why.** With the "find drivers by name" switch on, the daily upload answers with `byName`: a count of every row of the file and the lists that need a look (names not matched, disabled drivers, drivers paid at the main route's price, same-price sub-route moves, conflicts, routes, paid days). The upload page now keeps that answer and shows the "Drivers found by name" panel under the daily form. With the switch off the server sends no `byName` and the page looks as before. The switch stays off until this is in (Jasil).

**Edge to know (from Jasil's review of #344, no change needed).** If a wrong name match added parcels to a day that was entered by hand, that day is not in `daily_file_days`, so uploading the day again does not rebuild it: the parcels stay with the wrong driver and the right driver is listed as "same sequences as another driver" (held). Nobody is paid twice, but an admin has to fix that day by hand.

**Migration order before the switch goes on:** back up, then `2026-11-26-daily-match-by-name.sql`, then `2026-11-26-daily-file-days.sql`.

**Database.** None. **Config and dependencies.** None. **Money impact.** None (display only).

**Tested.** Frontend suite 653 passed; new page tests: the panel shows under the daily form when the answer carries `byName`, and nothing extra when it does not. By hand against the mock server (production limits, switch on): uploading the 6 Nov Dallas file showed the panel (4,649 rows = 3,066 added + 1,505 name not matched + 78 driver disabled; 28 driver days), and "Match" opened the Daily drivers page with the city and name filled in and no name in the address. **Not tested:** production. `DoubleStop.jsx` still has two lint errors from before this change (an unused handler and an unused `err`); not touched here.

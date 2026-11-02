# Driver Deliveries opens on the last ten days (issue #139)

- **Date:** 2026-11-03
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #139 (part of #138) / see the pull request for this branch
- **Branch:** `fix/driver-ten-day-history` (from `develop`)
- **Type and scope:** fix(frontend)
- **Files touched:** `Frontend/src/components/Drivers/Delivery.jsx`, `Frontend/src/hooks/translation.js` (one new key, EN and ES), new `Frontend/src/utils/dateRange.js`, new tests `Frontend/src/utils/dateRange.test.js` and `Frontend/src/components/Drivers/Delivery.test.jsx`, this journal entry. No reserved files.

**What the investigation found.** The client reported a work-history filter that showed only seven days. The only driver history screen is Deliveries (`/driver/delivery`). Neither production (`main`) nor `develop` has a seven-day limit anywhere: the screen sends whatever from and to dates the driver picks, the server checks only the date format and order, and the query returns every pay row in that range (`journey_date BETWEEN from AND to`, both ends included). Dates come back as plain `YYYY-MM-DD` text, so there is no time-zone shift. The cause could not be reproduced as a code limit. What the code did do: the screen opened empty and made the driver pick both dates every time. A day also only appears once its pay row exists (after the upload and calculation), so for weekly (GOFO) drivers the screen naturally shows about one uploaded week. That part is data timing, not this screen.

**What changed.**
- The screen now opens on the last **10 calendar days, today included**, in the phone's own date (for example 25 Oct to 3 Nov), and loads them without a click. A short line says so, in English and Spanish.
- A longer range the driver chooses is sent and shown in full. Nothing is cut to ten days.
- Reset goes back to the last ten days and reloads them (before, it emptied the screen).
- The saved result from the last five minutes is now tied to the driver who saved it. Before, it was shown to whoever opened the screen next on the same phone, even another driver, because nothing cleared it at sign-out.
- A saved result is handled once. Before, editing a date after a search announced the old row count again and saved the new dates together with the old rows.

Calendar days, not working days, is my choice, because the issue leaves it open. It shows every record in the window, including days off as gaps. If the owner wants ten *working* days instead, only `lastDaysRange` changes.

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None. No pay, rate, deduction, insurance or paid-history logic changed. The screen still shows the same rows and totals for the same dates.

**Tested.**
- New unit tests (6): ten days by default, month and year boundary, leap day, late night and just after midnight, a daylight-saving change (no skipped or repeated date), one day.
- New screen tests (7) with the real screen, slices and a fake server holding synthetic history (14 working dates over 3 weeks, days off, two routes on one date): opens on 25 Oct to 3 Nov and shows 9 rows from 8 dates without a click; a longer range shows all 15 rows; Reset returns to ten days; this driver's recent result is reused; another driver's saved result is never shown; a result saved before this change is ignored; the first load is quiet and only new results are announced, with their own count. The same tests fail on the old screen (3 of the first 4).
- Whole frontend suite: 110 tests pass. Lint passes on the changed files (whole app still 19 problems, all in Jasil's files, unchanged). The production build passes.
- Real backend query against the local database (`nasa_local`) with synthetic rows for the synthetic test driver, then removed: 10-day window returns 9 rows from 8 dates with both ends included; 20-day window returns all 15 rows from 14 dates. Afterwards the seeded journey, pay and delivery rows were all gone.
- By hand in a browser at phone width (390 px), signed in as the synthetic test driver: opens on 25 Oct to 3 Nov with 9 rows and no toast; no sideways page scroll; changing the start date does not announce anything; Filter shows 15 rows and "15 delivery records"; Reset returns to 9 rows.

**Not tested.** The Spanish text on screen (the key is in both languages and the same mechanism as every other key). A real phone. Production data. The mobile app WebView.

**Risks and follow-ups.**
- If the client's "seven days" was a weekly (GOFO) driver who sees one uploaded week, this change does not add more data; earlier weeks show once they are uploaded. Worth confirming with the client which driver and screen they meant.
- The saved result is still not cleared at sign-out; it is now only ever shown to the same driver, for up to five minutes.
- The "Insurance Days" and "Insurance ($1.92/day)" labels on this screen are still English only and repeat the rate. Not changed here (payroll work, #30 and #138).

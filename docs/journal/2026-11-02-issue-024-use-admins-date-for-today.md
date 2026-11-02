# Use the admin's own date for "today" and for the paid date (part of issue #24)

- **Date:** 2026-11-02
- **Author:** Jasil (with Claude Code)
- **Issue / PR:** #24 (second part; the issue stays open) / see the pull request for this branch
- **Branch:** `fix/use-admins-local-date-for-today` (from `develop`)
- **Type and scope:** fix(dashboard)
- **Files touched:** `Backend/controllers/admin/dashboardController.js`, `Backend/services/admin/dashboardQueries.js`, new `Backend/utils/businessDate.js`, `Frontend/src/redux/slice/admin/dashSlice.js`, this journal entry. Reserved files edited: the controller, the queries file and `dashSlice` (all Jasil's zone).

**What and why.** The dashboard's default view, its summary and the "mark as paid" date used the *server's* clock (UTC) as "today". For a US admin that clock is already tomorrow from about 6 pm Central onwards, so in the evening the default view showed an empty or wrong day, and paid journeys could be stamped with the next day. The screen now sends the admin's own calendar date (`today`, as `YYYY-MM-DD`) and the server uses it.

Safety rules in `businessDate.js`:
- Only a real date in `YYYY-MM-DD` form is accepted (`2026-02-31`, text, arrays and SQL-looking text are all refused).
- It must be within two days of the server date, so it cannot be used to backdate a payment far into the past.
- Anything refused falls back to the old behaviour (server date for the views, database date for the paid date). Old screens that send no `today` behave exactly as before.

**Database.** None. `payment_date` is now `COALESCE(<admin date>, CURRENT_DATE)`. The value is passed as a query parameter, not joined into the text.

**Config and dependencies.** None.

**Money impact.** None to amounts. Only which day is shown, and which date a payment is stamped with when an admin marks it paid.

**Tested.** The real controllers and query code against a throwaway local database (fake data, reconstructed schema), with the real clock at 2 Nov (UTC):
- Helper, with a fake clock at Saturday 9 pm Dallas (already Sunday in UTC): the admin's date wins; missing, empty, wrong format, impossible dates, months over 12, SQL-looking text, an array, 3 days away and the year 1999 all fall back; exactly 2 days away is accepted.
- Default view for an admin on Sunday evening 1 Nov: before, 0 rows; now, the 1 Nov row. The summary shows 5 packages instead of 0.
- Mark as paid, with city and data type filters (the parameter numbers shift by one): stamped with the admin's date. Without a date: stamped with the database date, as before. With junk: database date. For a different city: 0 rows updated. Without city and type filters: stamped correctly.
- Frontend: lint passes on the changed file; the production build passes.

**Not tested.** The screens in a browser, and the real database. The test data has no real driver or client data.

**Risks and follow-ups.**
- Cities in other time zones: the date follows the admin's device, not the city's zone. An admin in one zone looking at another city's "today" sees their own today. Making it follow each city's zone needs a per-city time zone (planned with the settings issue #114).
- Two unused `getTodayDate` helpers still exist in `Dashboard.jsx` and `DashboardTable.jsx` (one uses the UTC form). Not changed.
- Old journeys already stamped with the wrong `payment_date` are not corrected.

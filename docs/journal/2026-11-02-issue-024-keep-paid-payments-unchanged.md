# Keep paid payments unchanged when payments are recalculated (part of issue #24)

- **Date:** 2026-11-02
- **Author:** Jasil (with Claude Code)
- **Issue / PR:** #24 (first part; the issue stays open) / see the pull request for this branch
- **Branch:** `fix/keep-paid-payments-unchanged` (from `develop`)
- **Type and scope:** fix(dashboard)
- **Files touched:** `Backend/services/admin/dashboardQueries.js` (reserved file, owned by Jasil), this journal entry.

**What and why.** The "calculate payment" action re-prices journeys from the route's *current* prices. It did this for every journey, including ones already marked as paid. So after a route price changed, running it again silently changed what a driver had already been paid, and the company earnings with it. Both recalculation queries (`updatePaymentTable` and `updatePaymentTableForDate`) now skip journeys that are marked as paid. Unpaid journeys are calculated exactly as before.

**Database.** None. Query text only.

**Config and dependencies.** None.

**Money impact.** Paid rows no longer change. Unpaid rows are unchanged. Test result (fake data), one paid journey calculated at the old prices (10 first stops, 4 double stops), then the route's driver prices raised from 1.50 / 1.00 to 1.75 / 1.10:

| Row | Before the fix | After the fix |
|---|---|---|
| Paid journey: driver payment | 19.00 changed to **21.90** | 19.00 (unchanged) |
| Paid journey: company earnings | 6.20 changed to **3.30** | 6.20 (unchanged) |
| Unpaid journey (8 first, 2 double): driver payment | 16.20 | 16.20 |
| Unpaid journey: company earnings | 2.40 | 2.40 |
| Unpaid weekly-city journey (6 first, 3 double): driver payment / company earnings | 12.90 / 4.50 | 12.90 / 4.50 |

The same result holds for the all-dates action and the single-date action.

**Behaviour to know about.** If someone ever needs to correct a paid journey on purpose (for example a wrong price was used), "calculate payment" will no longer do it. There is no correction screen yet. That belongs to the payroll work (#30), with a record of who changed what and why. Until then it needs a manual, reviewed database change.

**Tested.** The real, unmodified query functions were run against a throwaway local database (`nasa_test_24`) built from the columns the code uses. Not run: the screens, the real production schema, or the database triggers. The triggers' source is not in the repository (issue #21 should save it), so any effect they have on `payment_dashboard` is not covered.

**Risks and follow-ups.**
- The test schema is a reconstruction, not production. Please run the same before and after check on a copy of the real database.
- The daily upload also re-derives delivery rows for paid journeys; that is handled separately.
- "Mark as paid" still stamps `payment_date` with the database's `CURRENT_DATE`; see the date finding recorded on #24.

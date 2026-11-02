# Limit pay, recalculate and upload actions to the admin's cities (issue #26)

- **Date:** 2026-11-02
- **Author:** Jasil (with Claude Code)
- **Issue / PR:** #26 / see the pull request for this branch
- **Branch:** `fix/limit-actions-to-admins-cities`. Built on top of `fix/keep-paid-payments-unchanged` (#24, first part) and `fix/use-admins-local-date-for-today` (#24, second part) because all three change the same functions. Merge those two first, or this one first; either order works.
- **Type and scope:** fix(security)
- **Files touched:** new `Backend/services/admin/adminCityAccess.js`; `Backend/controllers/admin/dashboardController.js`, `fileUploadsController.js`, `weeklyUploadsController.js`; `Backend/services/admin/dashboardQueries.js`. All reserved files, Jasil's zone.

**What and why.** The screens that *show* data already limit an admin to their assigned cities (payment table, summary, uploaded-data previews). The actions that *change* data did not: any admin could mark any driver as paid in any city, recalculate every city's payments, and upload a daily or weekly file that changes other cities' data. Now:

| Action | Super admin | City admin |
|---|---|---|
| Mark as paid | unchanged | Refused (403) if a city outside their list is named. If no city is named, only journeys on their cities' routes are paid. |
| Calculate payment (one date or all) | unchanged | Only their cities' journeys are recalculated. |
| Daily file upload | unchanged | Refused (403) if the file's deliveries include any city outside their list. Nothing is written. |
| Weekly file upload | unchanged | Refused (403) if the file's routes include any city outside their list. The staged data is not touched. |
| Add staged weekly data to the dashboard | unchanged | Refused (403) if the staged data includes any city outside their list. Nothing is inserted or cleared. |

Any role other than `superadmin` is treated as city-limited, so an unexpected role can never get wider access. An admin with no assigned cities can do nothing city-specific. Refusal messages do not name the other cities.

**Database.** None. The city list is read from `admin_city_ref` and `city`, as the screens already do.

**Config and dependencies.** None. `req.user` fields (`id`, `email`, `role`, `name`) and the role names are unchanged, as the work-split contract requires.

**Money impact.** None for super admins. For city admins, only which rows they can reach; amounts and formulas are unchanged.

**Tested.** The real controllers against a throwaway local database with fake data (reconstructed schema), as a super admin, a Dallas admin, an Austin admin and an admin with no cities: 33 checks, all passing. In every refusal, the five touched tables (`deliveries`, `dashboard_data`, `payment_dashboard`, `todays_excel_data`, `weeklycount`) were compared by row count and content hash before and after and were identical. Also confirmed against the same data that the payment table, the full payment list and the summary already show a Dallas admin only Dallas (2 of 3 rows, 24 of 33 packages) and nothing when Austin is asked for.

**Not tested.** The screens in a browser, and how the screens show a 403 message (the existing error toast reads the server message). The real database and triggers.

**Risks and follow-ups.**
- **Behaviour change for city admins:** a file that mixes cities used to upload; now it is refused. If a city admin legitimately uploads one combined file today, a super admin must upload it, or the admin must be assigned the extra cities.
- **Known limit, not fixed here:** after a *permitted* daily upload, the follow-up steps classify every still-unclassified delivery row in all cities (they have no city or date filter). The file itself cannot write to other cities any more, but this housekeeping can. Fixing it changes which rows get classified, so it needs a real-data check first. Recorded on #24.
- The weekly staging table is shared by all admins, so one admin's upload still replaces another's staged data. That is #29.

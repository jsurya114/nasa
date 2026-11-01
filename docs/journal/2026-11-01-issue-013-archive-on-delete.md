# Archive routes, step 4: delete archives instead of removing (issue #13)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #13 / see the pull request for this branch
- **Branch:** `chore/routes-archive-on-delete`
- **Type and scope:** chore(routes)
- **Files touched:** `Backend/services/admin/routeQueries.js`, `Backend/services/admin/journeyAccess.js`, `Backend/controllers/admin/adminJourneyController.js`, `Backend/controllers/driver/journeyController.js`, `Backend/services/driver/journeyQueries.js`, and the journey messages in `Backend/locales/backend/{en,es}.js` and `Frontend/src/locales/backend/{en,es}.js`. No reserved files; no dashboard, payment, analytics or Excel file was touched.
- **Needs first:** step 2 (the `routes.deleted_at` column, run on the real database) and step 3 (lists hide archived routes, pull request "hide archived routes"), released before or together with this.

**What and why.** "Delete route" used to remove the row. Per the schema notes, dashboard rows are removed together with their route, and deliveries and payments point at routes, so a delete either erased history or failed on a link. Now "delete" sets `deleted_at` and keeps the row:
- The screen and the answer ("Route deleted successfully") are the same. Deleting it again answers 404.
- Journeys, deliveries and payments keep pointing at the route, so old records still show its name and totals.
- An archived route can no longer be read, edited or switched on/off through the route screens (404), and it is already hidden from the lists (step 3).
- The city check added for issue #12 still applies first.
- Archiving also switches the route off (`enabled = false`). The weekly import only matches enabled routes, so an archived route no longer receives new weekly imports, which is what happened when the row was removed. (Added after the automated security review of the first commit.)
- A new journey cannot be added on an archived route (400, nothing written). Existing journeys on an archived route stay editable so history can still be corrected.

**Decision for the owner to confirm.** An archived route keeps its name and route code, and both must stay unique, so a new route with the same name or code is still refused. This was chosen because it needs no schema change. Freeing the name later would mean changing those unique rules in a separate database pull request.

**Database.** None in this pull request. It only uses the step 2 column.

**Config and dependencies.** None.

**Money impact.** None. Pay, rates and Excel files are untouched, and history rows are no longer removed.

**Tested.** A throwaway script (not committed) on a temporary local Postgres that has the column and the links as in the schema notes (history rows cascade on a route delete, deliveries and payments point at routes):
- The old delete of a route that has history failed on a link (and where a link cascades, history would go); the new one archives it.
- After the new delete, `dashboard_data`, `payment_dashboard` and `deliveries` are identical to before, the route's pay total is unchanged (60.00), and old records still join to the archived route's name.
- Through the real route handlers: a city admin still gets 403 for another city's route; own-city delete answers 200 with the same message; second delete 404; read, edit and switch on the archived route 404; a normal route can still be edited and switched; delete of a missing route 404; re-creating an archived name is refused.
- With step 3 also applied (checked on a temporary local branch), the archived route is gone from the superadmin list, its count and the admin dropdown.
Added after the review: archiving switches the route off; adding a journey on an archived route is refused (admin and superadmin, nothing written); a new journey on a live route still works; editing an old journey on the archived route still works; the earlier journey checks (old versus new, identical stored rows) still pass. Driver journey save (real handler and services, temporary Postgres): an archived route, an unknown route and bad ids (`abc`, `1abc`, `1e0`, `-1`) answer 400 and nothing is written to `dashboard_data` or `deliveries`; a live route still answers 201 and writes one journey and three deliveries; the overlap message on a live route is unchanged. Not tested: the screens in a browser, the real database.

**Risks and follow-ups.**
- Release order: back up, run the step 2 migration, then release steps 3 and 4. Without the column, route screens fail.
- Archived routes cannot be restored from the app. To restore one by mistake, a person clears `deleted_at` **and** sets `enabled = true` again in the database (its earlier on/off state is not remembered).
- **For the owner and Jasil (Excel zone, not changed here):** the daily Excel import and the analytics queries do not look at `enabled` or `deleted_at`, so a daily import can still match an archived route's code. The weekly import skips it. Whether the daily import should skip archived routes too is a decision for Jasil.
- `Backend/services/driver/routeQueries.js` still contains an old copy of the delete query, but nothing imports that file, so it cannot run.
- **Drivers cannot start a journey on an archived route either** (review comment from Jasil on the pull request). The driver journey save now checks, before writing anything, that the route exists and is not archived, and answers 400 with a message in English or Spanish ("This route is no longer available. Please choose another route."). This also covers a route form opened before an admin archived the route. Unusable route ids now answer 400 instead of 500, because the overlap check is skipped for them.

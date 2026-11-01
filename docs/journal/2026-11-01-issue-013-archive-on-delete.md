# Archive routes, step 4: delete archives instead of removing (issue #13)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #13 / see the pull request for this branch
- **Branch:** `chore/routes-archive-on-delete`
- **Type and scope:** chore(routes)
- **Files touched:** `Backend/services/admin/routeQueries.js`. No reserved files; no dashboard, payment, analytics or Excel file was touched.
- **Needs first:** step 2 (the `routes.deleted_at` column, run on the real database) and step 3 (lists hide archived routes, pull request "hide archived routes"), released before or together with this.

**What and why.** "Delete route" used to remove the row. Per the schema notes, dashboard rows are removed together with their route, and deliveries and payments point at routes, so a delete either erased history or failed on a link. Now "delete" sets `deleted_at` and keeps the row:
- The screen and the answer ("Route deleted successfully") are the same. Deleting it again answers 404.
- Journeys, deliveries and payments keep pointing at the route, so old records still show its name and totals.
- An archived route can no longer be read, edited or switched on/off through the route screens (404), and it is already hidden from the lists (step 3).
- The city check added for issue #12 still applies first.

**Decision for the owner to confirm.** An archived route keeps its name and route code, and both must stay unique, so a new route with the same name or code is still refused. This was chosen because it needs no schema change. Freeing the name later would mean changing those unique rules in a separate database pull request.

**Database.** None in this pull request. It only uses the step 2 column.

**Config and dependencies.** None.

**Money impact.** None. Pay, rates and Excel files are untouched, and history rows are no longer removed.

**Tested.** A throwaway script (not committed) on a temporary local Postgres that has the column and the links as in the schema notes (history rows cascade on a route delete, deliveries and payments point at routes):
- The old delete of a route that has history failed on a link (and where a link cascades, history would go); the new one archives it.
- After the new delete, `dashboard_data`, `payment_dashboard` and `deliveries` are identical to before, the route's pay total is unchanged (60.00), and old records still join to the archived route's name.
- Through the real route handlers: a city admin still gets 403 for another city's route; own-city delete answers 200 with the same message; second delete 404; read, edit and switch on the archived route 404; a normal route can still be edited and switched; delete of a missing route 404; re-creating an archived name is refused.
- With step 3 also applied (checked on a temporary local branch), the archived route is gone from the superadmin list, its count and the admin dropdown.
Not tested: the screens in a browser, the real database.

**Risks and follow-ups.**
- Release order: back up, run the step 2 migration, then release steps 3 and 4. Without the column, route screens fail.
- Archived routes cannot be restored from the app. A person can clear `deleted_at` in the database if one was archived by mistake.
- New journeys can still be created on an archived route by someone who sends its id. The route dropdowns no longer offer it. Blocking it would also block editing old journeys, so it was left out.

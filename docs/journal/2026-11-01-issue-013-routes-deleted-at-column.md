# Archive routes, step 2: add the `deleted_at` column (issue #13)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #13 / see the pull request for this branch
- **Branch:** `chore/routes-deleted-at-column`
- **Type and scope:** chore(routes)
- **Files touched:** `Backend/migrations/2026-11-01-issue-013-routes-deleted-at.sql` and `.rollback.sql` (new). No application code. No reserved files.

**What and why.** Deleting a route today removes its row for good. Per the schema notes in `Backend/config/dbquery.txt`, `dashboard_data` rows are set to be removed together with their route, so a delete can erase dashboard history, and `deliveries`, `payment_dashboard` and `route_taken_by_driver` point at routes. Issue #13 replaces delete with "archive". It is done in stages, one pull request each: (1) backup and a trial on a copy, (2) **this pull request**: add the column, (3) hide archived routes from lists and dropdowns, (4) make delete set the column.

This step only adds a nullable column `routes.deleted_at`. Nothing reads or writes it yet, and every route stays `NULL` ("not archived"), so the app behaves exactly as before.

**Database.**
```sql
ALTER TABLE routes ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
```
Rollback: `ALTER TABLE routes DROP COLUMN IF EXISTS deleted_at;` (only before steps 3 and 4 are released, because it forgets which routes were archived). Both files can be run more than once.

**Order of work on the real database.** Take a backup, run the migration on a copy, check, then run it on production. The migration must be run before the release that contains steps 3 and 4, never after.

**Config and dependencies.** None.

**Money impact.** None. Pay, rates and Excel files are untouched.

**Tested.** On a temporary local Postgres (not the project database) with a small `routes` table: the migration ran twice without error, the column is `timestamptz`, nullable, all rows `NULL`, row count unchanged; the rollback ran twice without error and removed the column. Not tested: a copy of the real database, which is step 1 and needs the real backup.

**Risks and follow-ups.**
- Adding a nullable column with no default is a quick change in Postgres and does not rewrite the table.
- Step 4 must decide what happens to the unique route name and route code once a route is archived (an archived route would still hold its name). That belongs to the step 4 pull request.
- Steps 3 and 4 must not edit dashboard or payment files; those keep reading archived routes so past records still show.

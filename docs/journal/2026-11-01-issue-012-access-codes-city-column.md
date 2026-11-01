# Access codes by city, step 1: add the `city_id` column (issue #12)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #12 / see the pull request for this branch
- **Branch:** `chore/access-codes-city-column`
- **Type and scope:** chore(access-codes)
- **Files touched:** `Backend/migrations/2026-11-01-issue-012-access-codes-city-id.sql` and `.rollback.sql` (new). No application code. No reserved files.

**What and why.** Access codes belong to no city, so an admin cannot be limited to the codes of their own cities. The owner chose to add a city column. This is done in stages (CONTRIBUTING and the engineering standard forbid doing it in one step):
1. **This pull request:** add a nullable `access_codes.city_id`, a foreign key to `city(id)` and an index. Nothing reads or writes it yet, so the app behaves exactly as before.
2. A person fills in the city for the existing access codes (see below).
3. Next pull request: the backend uses the column.
4. Last pull request: the add/edit form lets an admin pick a city.

**Database.** Exact SQL (the migration file is the source; it can be run more than once):
```sql
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS city_id integer NULL;
-- foreign key (added only if missing):
ALTER TABLE access_codes
  ADD CONSTRAINT access_codes_city_id_fkey FOREIGN KEY (city_id) REFERENCES city(id) ON UPDATE CASCADE ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_access_codes_city_id ON access_codes (city_id);
```
Rollback (only before the code that reads the column is released):
```sql
DROP INDEX IF EXISTS idx_access_codes_city_id;
ALTER TABLE access_codes DROP CONSTRAINT IF EXISTS access_codes_city_id_fkey;
ALTER TABLE access_codes DROP COLUMN IF EXISTS city_id;
```

**Existing rows (step 2, done by a person, not by this pull request).** Every existing access code stays `NULL` ("no city yet"). Which city each one belongs to cannot be worked out by the code, so the owner assigns them, for example by zip code:
```sql
UPDATE access_codes SET city_id = (SELECT id FROM city WHERE job = '<city job name>')
WHERE zip_code IN ('<zip>', '<zip>');
```
Until a code has a city, the next pull request keeps it visible to every admin (as today) and lets only a superadmin change it, so nothing disappears for anyone.

**Order of work on the real database.** Back up, run the migration on a copy, check, run it on production, then fill in the cities, then release the code that uses the column.

**Config and dependencies.** None.

**Money impact.** None. No pay, rate or Excel file touched.

**Tested.** On a temporary local Postgres (not the project database) with minimal `city` and `access_codes` tables holding two rows: the migration ran twice without error; the column is nullable, the foreign key and index exist, both rows stayed `NULL` and the row count is unchanged; a code with a valid city is accepted and one with an unknown city is refused; the rollback ran twice without error and removed the column, keeping both rows. Not tested: a copy of the real database.

**Risks and follow-ups.** `ON DELETE RESTRICT` means a city that has access codes cannot be deleted until the codes are moved; city deletion is not available in the app today.

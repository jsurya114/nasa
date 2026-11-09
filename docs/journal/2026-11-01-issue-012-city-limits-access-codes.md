# Admin city limits: access codes module (issue #12, part 7)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #12 / see the pull request for this branch
- **Branch:** `fix/admin-city-access-codes`
- **Type and scope:** fix(access-codes)
- **Files touched:** `Backend/services/admin/accessCodeAccess.js` (new), `Backend/services/admin/accessCodeQueries.js`, `Backend/controllers/admin/accessCodeControllers.js`. No reserved files.
- **Needs first:** the migration `Backend/migrations/2026-11-01-issue-012-access-codes-city-id.sql` (its own pull request) must already be run on the database. Without the `city_id` column these queries fail.

**What and why.** Access codes now belong to a city (new column `city_id`, step 1). With it:
- **List:** a superadmin sees every code. Any other admin sees the codes of their assigned cities and the codes that have no city yet.
- **Create:** the code gets a city. An admin with exactly one assigned city does not need to pick one (it is filled in, so the current form keeps working). An admin with several must send `city_id`, otherwise 400. The city must be one of theirs, otherwise 403. A superadmin may pick any city, or none.
- **Edit and delete:** only for codes in the admin's cities, and a code cannot be moved to a city that is not theirs. A code with no city yet (every code created before the column) is changeable by a superadmin only, which is how a superadmin can assign it a city.
- The id in the URL must be digits only (400 otherwise) and is used for both the check and the change. Editing a code that does not exist now answers 404 instead of 500.
- What an access code is, its images and its uniqueness rule are unchanged. The driver-side lookup is not changed.

**Database.** None in this pull request. It needs the column from the separate migration pull request, and the existing codes need a person to assign a city (SQL template in `2026-11-01-issue-012-access-codes-city-column.md`).

**Config and dependencies.** None.

**Money impact.** None.

**Tested.** A throwaway script (not committed) ran the real handlers against a temporary local Postgres with the new column (52 checks, all passed):
- A superadmin using the current form (no city) gets the same answers and the same stored codes (all columns that existed before) as the old controller.
- Lists: city admin, two-city admin, admin with no cities, superadmin; search and the pagination total count only visible codes.
- Create: single-city admin (city filled in), city that is not theirs (403), multi-city admin without a city (400) and with one (201), admin with no cities (400), bad city values (400), superadmin with a city, an unknown city (400) and no city.
- Edit and delete: another city's code, a no-city code, and moving a code to another city are all 403 with nothing changed; own city works; a multi-city admin can move a code between own cities; a superadmin can assign a city; missing code is 404; bad ids (`abc`, `1abc`, `0x1`, `1e0`, `-1`, `0`, `1.5`, empty) are 400.
Not tested: the screens in a browser, the real database, image upload to Cloudinary (not touched).

**Risks and follow-ups.**
- Until the form has a city picker (next pull request), an admin with several cities cannot create a code (they get "Choose the city for this access code"). Release the two pull requests together.
- Codes without a city stay visible to every admin until a person assigns them a city, then they are limited like the rest.
- Drivers can still look up access codes of every city. Limiting that is a separate decision.

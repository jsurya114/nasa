# Access codes by city, last step: city picker on the add form (issue #12)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #12 / see the pull request for this branch
- **Branch:** `fix/access-code-city-picker`
- **Type and scope:** fix(access-codes)
- **Files touched:** `Frontend/src/components/Admin/AccessCode.jsx`. No reserved files.
- **Goes with:** the access codes backend pull request (city rules) and the `city_id` migration.

**What and why.** The backend now saves every new access code with a city. An admin with one assigned city does not need to choose (the server fills it in). An admin with several cities must choose, and a superadmin may choose or leave it empty. The add form therefore gets a city drop-down:
- Shown to a superadmin (first option "No city") and to an admin with more than one city (first option "Select a city", required). Not shown to an admin with one city, so their form looks the same as before.
- The list of cities comes from the existing `get-admin-cities` call (every city for a superadmin, the assigned ones for other admins).
- The chosen city is sent as `city_id`. The form is cleared as before after saving.
The edit dialog is unchanged: editing a code keeps its city (the server keeps the stored city when none is sent).

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None.

**Tested.** `npm run build` succeeds. ESLint on the file reports 3 errors and 1 warning that were already there before this change (an unused variable, an unused function, an unused argument and a hook dependency; they belong to the lint clean-up issue #40); this change adds none. Not tested: the form in a browser, since it needs a running backend with the new column. A reviewer should open the form as a superadmin, as an admin with one city and as an admin with several, and create a code each time.

**Risks and follow-ups.**
- Release this together with the access codes backend pull request. Before it, an admin with several cities cannot create a code.
- The edit dialog has no city field. Changing a code's city is possible through the API (superadmin, or between an admin's own cities) but not from the screen yet.

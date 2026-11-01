# Admin city limits: agreements module (issue #12, part 4)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #12 / see the pull request for this branch
- **Branch:** `fix/admin-city-agreements`
- **Type and scope:** fix(agreements)
- **Files touched:** `Backend/services/admin/agreementAccess.js` (new), `Backend/controllers/admin/agreementController.js`. No reserved files.

**What and why.** The admin agreements screen listed every driver of every city, with signature name and dates, and let any admin revoke or mark as signed the agreement of any driver. Now:
- The list shows only drivers in the admin's assigned cities. A superadmin still sees everyone.
- Revoking or marking as signed needs the driver to be in one of the admin's cities, otherwise 403 and nothing is written. A driver with no city can be changed by a superadmin only.
- The driver id in the URL must be digits only (otherwise 400), and the same number is used for the city check and the change. A missing driver answers 404 as before.
What the revoke or sign action itself does to the driver row is unchanged.

**Database.** None. Query parameters only.

**Config and dependencies.** None.

**Money impact.** None. No pay, rate, Excel or dashboard file was touched, and the `drivers` columns written here (agreement fields) are not used by pay.

**Tested.** Throwaway scripts (not committed) on a temporary local Postgres with a minimal `drivers`, `city` and `admin_city_ref` (36 checks, all passed): the old controller (from `develop`) and the new one ran the same allowed actions (revoke and sign, as admin and as superadmin, plus a missing driver) from the same starting data, and the `drivers` table came out identical row for row (the "signed at" time stamp was compared as "just now", since it is set by the database clock) with the same answer codes. Superadmin list is identical to the old list. Admin list shows only own-city drivers, an admin with no cities sees none. Revoke or sign for a driver in another city, a driver with no city, or by an admin with no cities all give 403 with the table unchanged. Bad ids (`abc`, `1abc`, `0x1`, `1e0`, `-1`, `0`, `1.5`, empty) give 400. Not tested: the admin screen in a browser, and the production database.

**Risks and follow-ups.**
- A city admin with no assigned city now sees an empty agreements list. That is intended.
- The driver-facing agreement flow (signing in the app) is not changed.
- `agreementAccess.js` is separate from the helpers in the other #12 pull requests so each can merge on its own; a later `refactor` pull request should join them.

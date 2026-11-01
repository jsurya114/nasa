# UI redesign, stage 8: skeleton loading (issue #23)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / see the pull request for this branch
- **Branch:** `style/ui-skeleton-loading` (built on `style/ui-icons-gradients`; merge stages 1 to 7 first)
- **Type and scope:** style(frontend)
- **Files touched:** new `Frontend/src/reuse/Skeleton.jsx`; `Frontend/src/index.css`, `components/Loader.jsx`, `Drivers/Journey.jsx`, `Drivers/DriverAvailability.jsx`, `Drivers/accessCode.jsx`, `Admin/AccessCode.jsx`, `Admin/AdminJorney.jsx`, `Admin/AdminDriverAvailability.jsx`, `Admin/Jobs.jsx`, `Admin/routes-form.jsx`, `reuse/DriversList.jsx`, `reuse/AdminsList.jsx`; in Jasil's zone, presentation only as the repository owner asked on 2026-11-02: `Admin/DashboardTable.jsx`, `Admin/Analystic.jsx`, `reuse/UploadedData.jsx`, `reuse/TempUploadedData.jsx`.

**What and why.** Spinners and "Loading..." text become skeletons: soft violet placeholder shapes in the layout of the content that is coming, so the page does not jump when data arrives.
- **Parts (`Skeleton.jsx`):** a single block, table rows (inside the existing table, under its real column headers), a card list, and a whole page shell.
- **Page shell:** shown while a screen's code downloads (`Loader`, used by the app's lazy routes and the dashboard), and on the driver dashboard while the city type loads.
- **Tables:** admin journeys, routes, drivers and admins lists keep their headers and show placeholder rows.
- **Lists and cards:** access codes (admin and driver), admin availability, cities, the dashboard jobs table, uploaded data lists and analytics show placeholder cards. Driver availability shows seven placeholder day rows. The driver journey records show placeholder lines.
- **Accessibility and motion.** Each placeholder group is announced once ("Loading journeys...", "Loading drivers...", or the driver's language where the screen already had a translated text); the shapes themselves are hidden from screen readers. The light sweep stops under "reduce motion".

Button spinners (Saving..., Uploading..., Signing in...) stay as they are: they show that an action is running, not that content is loading.

**Not changed.** When loading starts or ends, what is fetched, error and empty states, handlers, texts. Each change swaps only the markup shown inside an existing loading condition. The diff was checked: no data, effect or handler line changed.

**Database.** None. **Dependencies.** None. **Config.** None. **Money impact.** None.

**Tested.** `npm run lint`: the same 19 findings as before, none new. `npm run build` succeeds. In a browser with local synthetic data and "Slow 3G": the page shell appeared while the journeys screen loaded and was announced as "Loading, please wait..."; pressing Refresh on admin journeys showed 6 placeholder rows (42 cells) under the real headers, announced as "Loading journeys...", with no sideways scroll at 375px.

Not tested: each of the other skeletons on screen (they share the same parts), Safari/Firefox.

**Risks and follow-ups.** Low. The sign-in check before protected pages still shows a blank screen for a moment (existing behaviour, not changed here); it could use the page shell in a later change.

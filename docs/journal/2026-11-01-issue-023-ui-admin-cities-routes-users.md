# UI refresh, part 8: admin cities, routes and users screens (issue #23)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / see the pull request for this branch
- **Branch:** `style/admin-jobs-routes` (built on `style/admin-header-nav`; merge the earlier UI pull requests first)
- **Type and scope:** style(frontend)
- **Files touched:** `Frontend/src/components/Admin/Jobs.jsx` (the Cities screen), `Frontend/src/components/Admin/routes-form.jsx`, `Frontend/src/components/Admin/AddUsers.jsx`. No reserved files.

**What and why.** Appearance only. These admin screens were built for desktop and are already mostly purple, so the changes are small.
- **Colours.** The blue gradient "Edit" buttons, the purple-700 save and add buttons, and the active filter button now use the shared brand purple. Status chips, the role badge and the other data colours are unchanged.
- **Phone spacing.** Card and page padding is smaller on phones (`p-4`) and unchanged from the `sm` size up.
- **Tapping.** Form fields are taller on phones only (`py-3`), and the same height as before from `sm` up. The Edit buttons are slightly taller.

**Not changed on purpose.** All handlers, validation, search, filter and paging logic, Redux and API calls, texts, and the city and access rules.

**Database.** None. **Config and dependencies.** None. **Money impact.** None: route and driver prices are shown and edited exactly as before.

**Tested.** `npx eslint` on the three files: no findings. `npm run build` succeeds. The diff was read: every change is a CSS class string. Not tested: the screens in a browser with an admin sign-in. The reviewer should check at phone and desktop width: add and edit a city, add and edit a route (prices unchanged), filter by status, and create a user.

**Risks and follow-ups.** Low. Next: the three big admin screens (journeys, availability, access codes), each in its own pull request.

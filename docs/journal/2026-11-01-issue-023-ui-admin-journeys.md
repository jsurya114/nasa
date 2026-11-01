# UI refresh, part 9: admin journeys screen (issue #23)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / see the pull request for this branch
- **Branch:** `style/admin-journeys` (built on `style/admin-jobs-routes`; merge the earlier UI pull requests first)
- **Type and scope:** style(frontend)
- **Files touched:** `Frontend/src/components/Admin/AdminJorney.jsx`. No reserved files.

**What and why.** Appearance only. This 1,200-line screen used bright blue for every action; the rest of the app is purple.
- Buttons, the selected page number, the filter panel border and heading, the "showing N of M" counts, the loading spinner, the focus rings and hover tints are now the shared brand purple.
- The page background tint is soft purple instead of blue.
- Cards and the paging bar have less side padding on phones (`p-4`), unchanged from the `sm` size up.
- The blue number badge in the table rows stays blue because it is a data label.

**Not changed on purpose.** All handlers, inline editing, validation, filters, paging, Redux and API calls, texts, and the city limits. The file is still over 1,200 lines; splitting it into smaller components is a refactor and is left for a separate pull request.

**Database.** None. **Config and dependencies.** None. **Money impact.** None: no pay or price is shown or edited differently.

**Tested.** `npx eslint` on the file: no findings. `npm run build` succeeds. The diff was read: every change is a CSS class string. Not tested: the screen in a browser with an admin sign-in. The reviewer should check at phone and desktop width: filter by date and driver, edit a journey inline and save, change pages and page size.

**Risks and follow-ups.** Low. Next: admin availability and admin access codes.

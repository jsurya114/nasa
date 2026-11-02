# Show 10 rows per page on Cities and Routes

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / see the pull request for this branch
- **Branch:** `fix/ten-rows-cities-routes` (built on `style/ui-table-scroll`; merge the earlier UI pull requests first)
- **Type and scope:** fix(frontend)
- **Files touched:** `Frontend/src/components/Admin/Jobs.jsx`, `Frontend/src/components/Admin/routes-form.jsx`, `Frontend/src/redux/slice/admin/routeSlice.js`. No reserved files.

**What and why.** The Cities table showed 3 rows and the Routes table 4 per page, which made long lists tedious. Both now request 10 per page. The page size is a named constant in each screen (`ITEMS_PER_PAGE`, `ROUTES_PER_PAGE`) and the routes slice default is 10. The backend already takes `limit` from the request, so it is unchanged; its fallback defaults (3 and 4) are only used when no limit is sent.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** See the pull request.

**Risks and follow-ups.** Low. Serial numbers on Cities use the page size, so they stay correct.

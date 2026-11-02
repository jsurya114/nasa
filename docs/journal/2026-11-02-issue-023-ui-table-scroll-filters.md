# UI redesign fix: search and filters stay put when a table scrolls sideways (issue #23)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / see the pull request for this branch
- **Branch:** `style/ui-table-scroll` (built on `style/ui-add-delivery-form`; merge the earlier UI pull requests first)
- **Type and scope:** fix(frontend)
- **Files touched:** `Frontend/src/components/Admin/Jobs.jsx`, `routes-form.jsx`, `AddUsers.jsx`, `Frontend/src/reuse/AdminsList.jsx`; and, as presentation-only class changes in Jasil's zone, `DoubleStop.jsx` and `Dashboard.jsx`.

**What and why.** On a phone, swiping a wide table sideways also dragged the card's title, search box and filter half out of view. The sideways scrolling was set on the whole card. It is now set only on the element that holds the table, so the title, search and filters stay in place and only the table moves. Pagination also stays fixed.
- Cities and Routes: scroll moved from the card to the table area.
- Users: the drivers list wrapper no longer scrolls (the list already scrolls its own table); the admins list now has its own table scroller.
- Daily/weekly uploaded data and the dashboard driver jobs: the outer card no longer scrolls; the table components inside already have their own scroller.

**Not changed on purpose.** Handlers, data, filters, paging, the tables themselves.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** Lint on the changed files; production build. In Chrome at 440px with the local admin: on Routes the table scrolls sideways while the search and city filter stay in place; on Cities, Users and Double Stop no search or filter control sits inside a scrolling area and the page has no sideways overflow. Not tested: tables with many rows on the dashboard and double-stop pages (the local database has no delivery data), real phones, Safari/Firefox.

**Risks and follow-ups.** Low. The admin and driver access-code tables only show from `md` up with their own clipping; not changed here.

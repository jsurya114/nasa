# The Dashboard's held data ends with the session (issue #186, review fix on #188)

- **Date:** 2026-11-04
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #186 / review fix on the Dashboard pull request (#188), also carried into #191
- **Branch:** `feat/keep-dashboard-state`
- **Type and scope:** fix(frontend)
- **Files touched:** `Frontend/src/redux/slice/admin/dashSlice.js`, `Frontend/src/components/Admin/Dashboard.jsx` (**Jasil's zone**, in review), test `Dashboard.keepView.test.jsx`; this entry.

**Review finding (Jasil, P1).** To keep a filtered table when the admin leaves the page and returns, the Dashboard stopped asking the server when Redux already held a filtered table. The `dash` slice was not reset at sign-out, and signing out does not reload the page, so the next administrator to sign in on the same tab found the previous one's table (driver names, pay and insurance amounts, maybe of a city they cannot see) and no request was made for their own. On `develop` the Dashboard always asked on opening, so this was a regression.

**The fix.** The Dashboard's data now ends with the session, the way the weekly upload summary does (#164):
- **Session boundary:** signing out (at its start, whatever its outcome), signing in, a manual sign-out, or the server ending the session resets the whole `dash` slice: table, filters, summary, dropdown lists and loading flags.
- **Late answers:** every dashboard read (table, today's table, summary, all-pay table, dropdowns, drivers and routes of a city) is recorded when it starts, with the administrator who asked. Its answer is used only if that record still exists. The reset clears the records, so an answer that arrives after the session changed is dropped.
- **Held only for the same person:** the table that is held remembers who asked for it, and the Dashboard treats it as held only if that is the signed-in administrator. This is a second guard in case a boundary were ever missed.

The same person coming back still keeps the filtered table, so the earlier behaviour is unchanged.

- **Database:** None. **Config and dependencies:** None. **Money impact:** None.

**Tested.** `Dashboard.keepView.test.jsx`, with the real sign-out and sign-in actions and one store (Jasil's reproduction): the next administrator's Dashboard asks for their own table and the old table is not in it; the same administrator coming back still keeps the table; a filtered table that was still on its way when the session changed is dropped on arrival. The first and third fail on the previous code. Whole frontend suite: 23 files, 216 tests pass; `vite build` succeeds; no new lint problems (`Dashboard.jsx` already had four unused-variable errors).

**Not tested.** By hand in the browser.

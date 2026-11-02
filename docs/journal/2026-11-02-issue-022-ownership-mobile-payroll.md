# Ownership change: mobile app to Jasil, payroll and QuickBooks to Jayasoorya (issues #22, #30, #31)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #22, #30, #31 / see the pull request for this branch
- **Branch:** `docs/ownership-mobile-payroll` (from `develop`)
- **Type and scope:** docs
- **Files touched:** `docs/OWNERSHIP.md`. No code.

**What and why.** At Jayasoorya's request the work is swapped. The mobile app (issue #22) moves to Jasil, and payroll and QuickBooks (issues #30 and #31) move to Jayasoorya. The GitHub assignees were changed to match. `OWNERSHIP.md` says it must be updated in the pull request that moves ownership, so:
- A new row gives the mobile app to Jasil: the `mobile/` folder, `Frontend/src/native/`, and the mobile parts of the sign-in code (`axiosInstance`, the driver and admin slices, the route guards).
- A new row gives new payroll and QuickBooks files to Jayasoorya. "New payroll and QuickBooks files" is removed from Jasil's Excel, pay and dashboard row. Existing pay, Excel and dashboard files stay Jasil's, so editing them still needs a conversation first.
- "Mobile app" is removed from Jayasoorya's "everything else" row, and its issue range is now #3 to #21 and #23.

The open mobile pull requests (#123, #125, #126, #127, #128) are not changed by this; Jasil continues from their branches. A full handover note was sent on Slack.

**Database.** None. **Config and dependencies.** None. **Money impact.** None. **Tested.** Read-through of the table only; no code changed.

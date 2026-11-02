# UI redesign fix: focus the first visible link in the More menu (issue #23)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / review comment on PR #102
- **Branch:** `style/ui-glass-navigation`
- **Type and scope:** fix(frontend)
- **Files touched:** `Frontend/src/reuse/GlassTabBar.jsx`. No reserved files.

**What and why.** From 380px wide the first link in the More menu is hidden, but opening the menu tried to focus it, so focus stayed on the More button. It now focuses the first link that is actually visible, so keyboard users land inside the menu.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** See the pull request. Not tested: Safari and Firefox.

**Risks and follow-ups.** Low. Only the initial focus target changed.

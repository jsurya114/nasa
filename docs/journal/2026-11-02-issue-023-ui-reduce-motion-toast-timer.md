# UI redesign fix: keep the notification timer under Reduce Motion (issue #23)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / review comment on PR #101
- **Branch:** `style/ui-design-foundation`
- **Type and scope:** fix(frontend)
- **Files touched:** `Frontend/src/index.css`. No reserved files.

**What and why.** The "Reduce Motion" rule shortened every animation to 0.01 ms. React Toastify closes a notification when its progress-bar animation ends, so with Reduce Motion on, messages disappeared almost at once. The progress bar (`.Toastify__progress-bar`) is now excluded from that rule and keeps its real duration. Decorative motion stays reduced.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** See the pull request for the checks run. Not tested: Safari and Firefox.

**Risks and follow-ups.** Low. One selector changed.

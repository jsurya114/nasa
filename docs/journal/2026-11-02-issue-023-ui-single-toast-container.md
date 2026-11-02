# UI redesign fix: one notification container for the whole app (issue #23)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / review comment on PR #103
- **Branch:** `style/ui-notifications`
- **Type and scope:** fix(frontend)
- **Files touched:** `Frontend/src/components/Admin/DriverPaymentUpdate.jsx` (reserved zone; only the extra toast container and its CSS import were removed, no logic). Approved scope: presentation-only edits.

**What and why.** The File Upload screen still mounted its own notification container. When that screen closed, it removed the app-wide one too, so notifications on other screens (for example Cities) disappeared until a reload. That container and its duplicate CSS import are removed; the app-wide `AppToaster` (CSS imported in `App.jsx`) is now the only container.

**Database.** None. **Config and dependencies.** None. **Money impact.** None: the payment calculation is untouched.

**Tested.** See the pull request. Not tested: Safari and Firefox.

**Risks and follow-ups.** Low. Notifications from the upload screen now use the app-wide container's settings (3 at a time, themed) instead of a 3 second one.

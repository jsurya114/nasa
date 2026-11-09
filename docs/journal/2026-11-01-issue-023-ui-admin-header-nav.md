# UI refresh, part 7: admin header and bottom navigation (issue #23)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / see the pull request for this branch
- **Branch:** `style/admin-header-nav` (built on `style/driver-access-codes`; merge the earlier UI pull requests first)
- **Type and scope:** style(frontend)
- **Files touched:** `Frontend/src/reuse/Header.jsx`, `Frontend/src/reuse/Nav.jsx`. These are shared parts. They take no props and are also shown on Jasil's screens (dashboard, uploads, analytics), so those screens get the new bar too. None of Jasil's own files is edited.

**What and why.** Appearance only, matching the driver bar done in part 2.
- **One purple.** The header and bar use the shared brand purple instead of a slightly different hex.
- **Bottom bar.** Eight white cards became a plain bar: white icons and labels, the current page as a white pill, items at least 52px tall, the phone's bottom safe area respected, and a visible keyboard focus ring. It scrolls sideways on a phone as before. It is shorter than before, so no page content gets hidden.
- **Header.** The phone menu button has a larger tap area, reports whether it is open and has a focus ring. The logout button in the phone menu is taller.
- **Console warning.** The old bar contained a `<style jsx>` block (a Next.js feature that does nothing here and makes React print a warning). The same "hide the scrollbar" rule is now written with Tailwind classes, so the warning is gone and the scrollbar is still hidden.

**Not changed on purpose.** Links, routes, labels, logout, Redux calls. The English-only labels stay as they are (translating the admin side is a separate task).

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** `npx eslint src/reuse/Header.jsx src/reuse/Nav.jsx`: no findings. `npm run build` succeeds and the built CSS contains the scrollbar rule. Not tested: the screens in a browser with an admin sign-in. The reviewer should open an admin page and a dashboard page at phone width: all eight tabs reachable by sideways scroll, current tab highlighted, menu opens, logout works.

**Risks and follow-ups.** Low. Next: the large admin screens, one per pull request.

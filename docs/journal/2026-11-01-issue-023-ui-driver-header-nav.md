# UI refresh, part 2: driver header and bottom navigation (issue #23)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / see the pull request for this branch
- **Branch:** `style/driver-header-nav` (built on `style/login-screens-brand-tokens`, merge that pull request first)
- **Type and scope:** style(frontend)
- **Files touched:** `Frontend/src/reuse/driver/Header.jsx`, `Frontend/src/reuse/driver/Nav.jsx`. No reserved files.

**What and why.** Appearance only, for the bar at the top and the tab bar at the bottom of every driver screen.
- **One purple.** The header and tab bar used a slightly different hex purple (`#462976`) from the login screens. They now use the shared `brand` colour, so the app has one purple. The shade shifts by a hair.
- **Tab bar.** It was six white cards, which is heavy on a small phone. It is now a plain bar: icons and labels in white, the current page shown as a white pill. Items are at least 52px tall for easier tapping, the bar respects the phone's bottom safe area, and the keyboard focus ring is visible. The bar is shorter than before, so no page content ends up hidden behind it. The password tab icon changed from a sleeping face to a lock.
- **Header.** The menu button and the language and logout buttons in the phone menu have larger touch areas. The menu button reports whether it is open (`aria-expanded`) and has a focus ring.

**Not changed on purpose.** Links, routes, language switching, logout, Redux calls, texts. The "Agreement" tab label is still hard-coded English instead of going through the translation helper. Fixing it needs a new translation key in both languages, so it is left for a separate change.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** `npx eslint src/reuse/driver`: no findings. `npm run build` succeeds and the built CSS contains the new classes. Not tested: the screens in a browser at phone and desktop width, because they need a driver sign-in. The reviewer should open any driver page at phone width and check: all six tabs fit, the current tab is highlighted, the menu opens, language switch and logout still work.

**Risks and follow-ups.** Low. Next part: the driver journey and delivery screens.

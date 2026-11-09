# UI refresh, part 10: icons instead of emojis in the headers and tab bars (issue #23)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / see the pull request for this branch
- **Branch:** `style/replace-emojis-with-icons` (built on `style/admin-journeys`; merge the earlier UI pull requests first)
- **Type and scope:** style(frontend)
- **Files touched:** `Frontend/src/reuse/Header.jsx`, `Frontend/src/reuse/Nav.jsx`, `Frontend/src/reuse/driver/Header.jsx`, `Frontend/src/reuse/driver/Nav.jsx`. The admin `Header` and `Nav` are shared and also appear on Jasil's screens; none of his own files is edited.

**What and why.** Emojis look different on every phone and are hard to see on a coloured bar. This part replaces the emojis in the two headers and the two tab bars with `lucide-react` icons (already a dependency, no new package). They draw the same on every device, take the text colour of the bar and are hidden from screen readers because each tab already has a text label.
- Admin tabs: dashboard, users, routes (compass), cities (building), file upload, access codes (key), availability (calendar), agreements (document).
- Driver tabs: dashboard, access codes, deliveries (truck), availability, agreement, password (lock).
- The user avatar in both headers (a person icon in the yellow circle), desktop and phone menu.

**Not changed on purpose.** Links, labels, routes, logout, language switch, Redux. Emojis inside texts and screens are replaced in the next parts of this series.

**Database.** None. **Config and dependencies.** None (`lucide-react` was already installed). **Money impact.** None.

**Tested.** `npx eslint` on the four files: no findings. `npm run build` succeeds. Not tested: the bars in a browser with a sign-in. The reviewer should check that each tab shows its icon, the current tab turns white with a purple icon, and the avatar shows in the header and the phone menu.

**Risks and follow-ups.** Low. Next parts: emojis in the driver screens, then in the admin screens (Jasil's files are left for him).

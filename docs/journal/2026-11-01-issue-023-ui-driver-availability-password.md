# UI refresh, part 4: driver availability and password screens (issue #23)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / see the pull request for this branch
- **Branch:** `style/driver-availability-password` (built on `style/driver-journey-delivery`; merge the earlier UI pull requests first)
- **Type and scope:** style(frontend)
- **Files touched:** `Frontend/src/components/Drivers/DriverAvailability.jsx`, `Frontend/src/components/Drivers/UpdatePassword.jsx`. No reserved files.

**What and why.** Appearance only. The availability screen was already built for phones, so it only needed small touches; the password screen needed a bit more.
- **Availability.** The save button, the loading spinner and the switch focus ring use the shared purple instead of blue. The save and reset buttons are a little taller to tap. The "today" highlight (blue) and the available (green) and locked (grey) colours keep their meaning and are unchanged.
- **Password.** The page header is solid purple instead of a blue gradient, the driver info band is soft purple, the focus rings and the submit button use the shared purple, and padding is smaller on phones. The show/hide eye buttons have a larger tap area, with the icon in the same place. The blue "security tips" box stays blue because it is an information box.

**Not changed on purpose.** Handlers, validation, Redux and API calls, the password rules, texts. The show/hide eye buttons still have no spoken label, because adding one needs new translation keys in both languages; that is left for a separate change.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** `npx eslint` on both files: no findings. `npm run build` succeeds. The diff was read: every change is a CSS class string. Not tested: the screens in a browser with a driver sign-in. The reviewer should check at phone and desktop width: toggle a day and save availability, and change a password with a wrong current password, a mismatch and a correct one.

**Risks and follow-ups.** Low. Next parts: driver access-code and agreement screens, then the admin shell.

# UI refresh, part 1: brand colour and login screens (issue #23)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / see the pull request for this branch
- **Branch:** `style/login-screens-brand-tokens`
- **Type and scope:** style(frontend)
- **Files touched:** `Frontend/src/index.css`, `Frontend/src/components/Admin/Login.jsx`, `Frontend/src/components/Drivers/DriverLogin.jsx`. No reserved files.

**What and why.** First small step of the UI refresh, appearance only.
- **Brand colour named once.** `index.css` now defines `brand` (the same purple the login screens already used) and `brand-dark` (the same dark purple as the old hover colour). Screens can use `bg-brand` instead of repeating a long colour value. Both login screens use it. The colours on screen are unchanged.
- **Password show/hide control.** It was a clickable `span`; it is now a real `button` (`type="button"`, so it never submits the form) with a text label for screen readers, a larger touch area and a visible focus ring. It toggles the same state as before.
- **Admin login.** Labels, error text spacing and the error message size now match the driver login. Fields got `autoComplete` hints (`email`, `current-password`) so password managers and phone keyboards work properly. The driver login got the same hints.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Not changed on purpose.** Submit handlers, validation, Redux calls, routes and texts. The unused `font-poppins` class is left alone: no Poppins font is loaded, so defining it would change the look of every screen.

**Tested.** `npm run build` succeeds, and the built CSS contains `bg-brand` and the two colour variables. `npx eslint` on both files: no findings. Not tested: a real login in a browser, and phone-width screenshots. The reviewer should look at both login screens at phone and desktop width and try one login per role.

**Risks and follow-ups.** Low. Next parts: driver layout and journeys, then admin shell.

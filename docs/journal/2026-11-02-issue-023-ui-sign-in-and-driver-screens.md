# UI redesign, stage 4: sign-in and driver screens (issue #23)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / see the pull request for this branch
- **Branch:** `style/ui-driver-screens` (built on `style/ui-notifications`; merge stages 1 to 3 first)
- **Type and scope:** style(frontend)
- **Files touched:** `Frontend/src/index.css`, `Frontend/src/components/Admin/Login.jsx`, and the driver screens `Drivers/DriverLogin.jsx`, `Journey.jsx`, `Delivery.jsx`, `DriverAvailability.jsx`, `UpdatePassword.jsx`, `accessCode.jsx`, `DriverAgreement.jsx`, `DriverViewAgreement.jsx`. No reserved files.

**What and why.** Presentation only.
- **Sign-in (admin and driver).** Deep violet background with soft light (`bg-aurora`), a white card with a large radius and soft depth, the logo band in the logo's own colour (no box around the logo), 48px fields and button with a gentle focus glow, and the show/hide password button centred in its field. Text, fields, validation and the login calls are unchanged.
- **One card style.** A new `card-surface` (solid white, fine violet-grey border, soft shadow, larger radius) replaces several different card styles across the driver screens. Pages use the new canvas colour. Grey borders became the shared `line` colour.
- **Journey records on phones.** One card per journey (route, date, packages, start and end sequence). Tablets and desktops keep the table. The driver's own name column is shown in the table only.
- **Delivery on phones.** One card per day with date, route, route code, earning, closed and paid badges and every count from the table. The route price and double-stop price are now visible on phones too; before, they were only in a mouse-hover tooltip. Tablets and desktops keep the table with its tooltip.
- **Delivery summary.** The totals were read-only input boxes; they are now clean number tiles (`dl`/`dt`/`dd`). The label and value text is exactly the same.

**Not changed.** Calculations, values, rounding, the insurance figures, what is fetched or saved, routes, texts.

**Database.** None. **Dependencies.** None. **Config.** None.

**Money impact.** None. Before-and-after check on the delivery screen with the same synthetic fixture (six days, insurance on every day): all 7 summary values (Total Packages 783, First Stop 642, Double Stop 81, Delivered 690, Insurance Days 6, Insurance -$11.52, Total Earning $1216.98) and all 6 table rows were identical, character for character.

**Tested.** `npx eslint` on the changed files: no findings. `npm run build` succeeds. In a browser with local synthetic data:
- Driver sign-in at 375px: no sideways scroll, the password toggle is centred and 42px.
- Delivery at 375px: summary tiles and six day cards, no sideways scroll; at 1280px the table shows and the cards are hidden.

Not tested: the journey cards with records (the synthetic driver had no journey for today, so the empty state showed), Safari/Firefox.

**Risks and follow-ups.** Low. Next stage: admin screens (not Jasil's).

# UI redesign, stage 5: admin screens and small-screen fixes (issue #23)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / see the pull request for this branch
- **Branch:** `style/ui-admin-screens` (built on `style/ui-driver-screens`; merge stages 1 to 4 first)
- **Type and scope:** style(frontend)
- **Files touched:** `Admin/AddUsers.jsx`, `Jobs.jsx`, `routes-form.jsx`, `AccessCode.jsx`, `AccessCodeEditDialog.jsx`, `AdminJorney.jsx`, `AdminDriverAvailability.jsx`, `AdminDriverAgreements.jsx`, `NotFound.jsx`, `components/AccessCodeDetailsDialog.jsx`, `reuse/AdminsList.jsx`, `reuse/DriversList.jsx`, `reuse/Search.jsx`, `Drivers/DriverAvailability.jsx`. No reserved files: Jasil's dashboard, payment, upload and analytics screens are not edited.

**What and why.** Presentation only. Every change is a CSS class.
- **Same look as the driver side.** Admin pages use the canvas background and the shared `card-surface`; grey borders use the shared `line` colour; table headers get a faint violet tint; dialogs (edit and view access code, journey modal) get a larger radius and the soft floating shadow; page titles use the `ink` colour.
- **Access codes (admin).** The brighter purple (`#8200db`) left on this screen and its two dialogs is now the brand purple, matching the driver screen.
- **No sideways scroll on small phones.** The shared search box had a fixed 256px width, so the Agreements page was 482px wide on a 375px phone and dialogs on that page opened off-centre. The search box now fills the width on phones (256px from the `sm` size up), and the Agreements header stacks on phones. The Journeys page title row now wraps (352px wide at 320px before). The driver Availability day rows let their text wrap so the on/off switch stays on screen at 320px (349px wide before).

**Not changed.** Handlers, data, filters, paging, permissions, routes, texts, prices.

**Database.** None. **Dependencies.** None. **Config.** None. **Money impact.** None: route and driver prices are shown and edited exactly as before.

**Tested.** `npx eslint` on the changed files: no findings. `npm run build` succeeds. The diff was checked: every changed line is part of a class string. In a browser with local synthetic data, every admin page (dashboard, users, routes, cities, file upload, access codes, availability, agreements, journeys) and every driver page has no sideways scroll at 320px and 375px. Admin access codes checked at 1280px.

Not tested: every dialog and form submit on the admin screens by hand, Safari/Firefox.

**Risks and follow-ups.** Low. Jasil's screens get the new navigation, header, toasts and font automatically, but their own layouts were not changed; he can adopt `card-surface`, the brand scale and `utils/toast.js` when he next works on them.

# UI refresh, part 11: icons instead of emojis in the driver screens (issue #23)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / see the pull request for this branch
- **Branch:** `style/replace-emojis-driver-screens` (built on `style/replace-emojis-with-icons`; merge the earlier UI pull requests first)
- **Type and scope:** style(frontend)
- **Files touched:** `Frontend/src/components/Drivers/DriverLogin.jsx`, `DriverViewAgreement.jsx`, `Journey.jsx`, `Delivery.jsx`, `accessCode.jsx`, `DriverAvailability.jsx`. No reserved files.

**What and why.** Emojis look different on every phone. They are replaced with `lucide-react` icons (already installed), which draw the same everywhere, follow the text colour and are hidden from screen readers.
- Login: globe next to the detected time zone. Signed agreement: green check circle. Journey: warning triangle in the "recently updated" notice.
- Access codes: map pin (ZIP code), camera (image count), lock (access code).
- Availability: globe (time zone), refresh arrows (weekly reset heading and note), clock (tomorrow cut-off note).
- Delivery summary: the shield in the two insurance labels is now a shield icon drawn by the screen; the label text itself no longer contains an emoji.

**Not changed on purpose.** All texts, translations, logic, handlers, Redux and API calls. Emojis that live inside the shared translation file (`showDaily`, `showWeekly`, `showingSpeedxData`, `showingGofoData`, and the lock mentioned in `editingRestrictionsDesc`) are left alone: they are shared with other screens and the daily/weekly names are business labels, so they need a decision first.

**Database.** None. **Config and dependencies.** None. **Money impact.** None: the insurance days and deduction amounts shown in the delivery summary are the same values as before.

**Tested.** `npx eslint src/components/Drivers`: no findings. `npm run build` succeeds. A search finds no emoji left in the driver screens apart from the ones inside the translation file. Not tested: the screens in a browser with a driver sign-in. The reviewer should check each place above and compare the delivery summary numbers with the old screen.

**Risks and follow-ups.** Low. Next part: emojis in the admin screens (not Jasil's).

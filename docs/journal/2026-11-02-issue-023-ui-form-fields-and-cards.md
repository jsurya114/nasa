# UI redesign, stage 6: one style for every input field and card (issue #23)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / see the pull request for this branch
- **Branch:** `style/ui-form-fields` (built on `style/ui-admin-screens`; merge stages 1 to 5 first)
- **Type and scope:** style(frontend)
- **Files touched:** `Frontend/src/index.css` and 26 screens and shared parts (every file with an input, select or textarea, plus card wrappers).
- **Reserved files:** yes, presentation only. The repository owner asked on 2026-11-02 for the same input and card look on every page, including the dashboard and upload screens, with no change to behaviour. Touched in Jasil's zone: `Admin/Dashboard.jsx`, `Admin/DashboardTable.jsx`, `Admin/DoubleStop.jsx`, `Admin/Analystic.jsx`, `Admin/DriverPaymentUpdate.jsx`, `reuse/UploadedData.jsx`, `reuse/TempUploadedData.jsx`, `components/Excel-InputTag.jsx`. Only `className` strings changed in those files. Jasil reviews.

**What and why.**
- **All 77 text, number, date, email, password and search fields, selects and textareas** now share one look: 12px radius, the soft `line` border, white background, `ink` text, a softer placeholder, a 4px violet focus glow and a gentle transition. Fields are at least 44px tall (easy to tap), except small inline editors inside tables. Colours a field already had for a reason (read-only grey, disabled, error red) are kept: an error border still turns red, and its focus glow is red.
- **File pickers** (access-code photos, Excel upload) get a proper soft violet "Choose files" button. Only the look of the picker changed; accepted types, limits and the upload code are untouched.
- **Cards** on the remaining pages (dashboard, uploads, analytics, payment update, journeys, availability, access codes, agreements) use the shared `card-surface`. Grey-gradient table header and footer bands are now a flat soft violet tint. Table pagination arrows use the shared border and hover colours.
- **Dividers.** Tailwind 4 draws a bare `border` in the text colour, so lines meant to be light grey showed as heavy black lines (for example between the dashboard filters). A base rule restores a soft default border colour; any explicit colour still wins.
- **Section headers** on Cities and Routes now line up with their card on phones.

The field classes were rewritten by a small script that only touches the class string of `<input>`, `<select>` and `<textarea>` tags (checkboxes, radios and hidden fields skipped). The diff was checked: only class strings changed.

**Not changed.** Handlers, validation, values, file upload behaviour (types, limits, what is sent), Excel import, pay and dashboard calculations, texts, routes.

**Database.** None. **Dependencies.** None. **Config.** None. **Money impact.** None.

**Tested.** `npm run lint`: the same 19 findings as before, all in Jasil's files, none new. `npm run build` succeeds. A script confirmed all 77 fields got the new style. In a browser with local synthetic data: driver sign-in field 48px tall with a 12px radius; empty submit turns the border red with the error text shown; keyboard focus shows the 4px glow. Admin Routes at 375px and the dashboard at 1280px checked by screenshot (no black divider lines).

Not tested: every form submit by hand, a real Excel upload, Safari/Firefox.

**Risks and follow-ups.** Low. Next: icons for the dashboard emojis and the access-code tiles, then skeleton loading.

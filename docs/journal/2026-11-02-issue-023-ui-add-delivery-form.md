# UI redesign, stage 9: "Add Delivery" form on admin journeys (issue #23)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / see the pull request for this branch
- **Branch:** `style/ui-add-delivery-form` (built on `style/ui-skeleton-loading`; merge stages 1 to 8 first)
- **Type and scope:** style(frontend)
- **Files touched:** `Frontend/src/components/Admin/AdminJorney.jsx`. Not a reserved file.

**What and why.** The "Add New Journey" form on the admin journeys screen had mismatched fields and an old-style button.
- **Wording:** the form says "delivery" instead of "journey": title "Add New Delivery", label "Delivery Date", button "Add Delivery" ("Adding..." while saving), the date-required error, and the success and failure messages for adding.
- **Same size fields:** the Driver and Route dropdowns were 38px tall with a green border and a wrapping placeholder; the date and number inputs were 44px with a green focus ring. All five fields are now 44px tall, with the same radius, border and violet focus ring. The dropdown placeholders are shorter ("Select driver", "Select route") so they stay on one line. The dropdowns are still searchable.
- **Button:** solid violet, rounded, 44px tall, Plus icon, spinner icon while adding, full width on a phone. The green card border and green heading became the standard card.

**Not changed.** Handlers, validation, the API call, what is sent, the table, filters, edit and delete. The filter section and the table headings still say "journey".

**Database.** None. **Dependencies.** None (Lucide icons were already used). **Config.** None. **Money impact.** None.

**Tested.** `eslint` on the file: clean. `vite build` succeeds. In a browser against the local app: the five fields measured 44px each; the form shows the new wording and button.

Not tested: adding a delivery end to end after this change (no handler line changed), phone width, Safari/Firefox, the Spanish screens (this admin screen is English only).

**Risks and follow-ups.** Low. The page still calls the records "journeys" elsewhere; renaming those is a separate decision.

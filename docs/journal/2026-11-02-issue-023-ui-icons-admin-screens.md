# UI refresh, part 12: icons instead of emojis in the admin screens (issue #23)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / see the pull request for this branch
- **Branch:** `style/replace-emojis-admin-screens` (built on `style/replace-emojis-driver-screens`; merge the earlier UI pull requests first)
- **Type and scope:** style(frontend)
- **Files touched:** `Frontend/src/components/Admin/AdminDriverAvailability.jsx`, `AccessCode.jsx`, `AdminDriverAgreements.jsx`, `Jobs.jsx` and `Frontend/src/reuse/AddAdminForm.jsx`. No reserved files.

**What and why.** Emoji and text symbols (✓ ✕ ○) look different on every device and are small. They are replaced with `lucide-react` icons (already installed).
- **Availability (admin):** the enabled and disabled chips get a check and an empty circle; the day buttons get a check or a cross icon; the info list gets a green check, a red cross and refresh arrows; the "reset all" warning gets a warning triangle; the active filter note gets a magnifier.
- **Access codes (admin):** a camera icon in the image-count chip.
- **Agreements (admin):** a document icon on the "View Agreement" button.
- **Cities:** a warning triangle or an info icon next to the city-type hint.
- **Add-admin form:** an info icon next to "Role cannot be changed during edit".

**Words changed.** Where an icon cannot be drawn, the symbol was simply dropped and the words kept: the two entries inside the availability filter dropdown (a drop-down option can only hold text), the browser's confirmation question for "reset all" (now starts with "WARNING:" instead of a warning emoji) and the "drivers reset" success toast (the toast already shows its own success icon). No wording was otherwise changed.

**Not changed on purpose.** Logic, handlers, Redux and API calls, texts, who may do what. Jasil's files (dashboard, table, analyzer) are not touched; their emojis are listed on the pull request for him.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** `npx eslint` on the five files: no findings. `npm run build` succeeds. A search finds no emoji left in these five files. Not tested: the screens in a browser with an admin sign-in. The reviewer should check each place above, toggle a day and save, and run the filter.

**Risks and follow-ups.** Low. After this only Jasil's files and the shared translation file still contain emojis.

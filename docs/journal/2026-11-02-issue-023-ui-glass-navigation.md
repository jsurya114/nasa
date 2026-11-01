# UI redesign, stage 2: floating glass navigation (issue #23)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / see the pull request for this branch
- **Branch:** `style/ui-glass-navigation` (built on `style/ui-design-foundation`; merge that first)
- **Type and scope:** style(frontend)
- **Files touched:** new `Frontend/src/reuse/GlassTabBar.jsx`; `Frontend/src/reuse/Nav.jsx`, `Frontend/src/reuse/driver/Nav.jsx`, `Frontend/src/reuse/Header.jsx`, `Frontend/src/reuse/driver/Header.jsx`, `Frontend/src/hooks/translation.js`, `Frontend/src/index.css`. The admin `Nav` and `Header` are shared and also appear on Jasil's screens; none of his own files is edited.

**What and why.** The bottom bar became a floating "liquid glass" bar, shared by admin and driver through one component.
- **Glass with fallbacks.** Translucent violet with blur, a fine light border and a soft shadow. It falls back to solid violet where blur is not supported or "reduce transparency" is on.
- **Labels always fit.** On phones the bar shows four links plus "More" (three plus "More" under 380px wide), and the rest sit in a "More" menu. Tablets and desktops show every link. Labels can wrap to two lines and hyphenate in the right language (`lang` is set), so Spanish labels such as "Códigos de acceso" and "Disponibilidad" fit. Before this change six labels overlapped on a 375px phone.
- **"More" menu.** A light glass panel above the bar. Opening it moves focus to the first link; Escape or a tap outside closes it, and Escape returns focus to "More". "More" shows as active when the current page is inside it.
- **Never covers content.** The bar respects the phone's home-bar safe area, and a spacer in the page flow means the last fields and buttons can always be scrolled clear of it.
- **Touch and keyboard.** Every target is at least 56px tall. Links keep `aria-current="page"`, the bar has a translated name for screen readers, and icons are hidden from them because each item has a text label.
- **Header.** Respects the notch, has softer menus (light glass, rounded) and rounder buttons. It stays solid `#462976`, because the logo image has that exact background colour; a see-through bar would show a box around the logo.
- **Translations.** New driver keys in English and Spanish: `agreementTab` ("Agreement" / "Acuerdo"), `more` ("More" / "Más"), `mainNavigation`. The "Agreement" tab was the only English-only driver label.

**Not changed.** Links, their order, routes, logout, language switching, Redux. No business rule.

**Database.** None. **Dependencies.** None. **Config.** None. **Money impact.** None.

**Tested.** `npx eslint` on the changed files: no findings. `npm run build` succeeds. Checked in a browser with local synthetic data (no real data):
- Driver at 320px (English): three links plus "More", no broken words; "More" menu opens, focus moves into it, Escape closes it and returns focus.
- Driver at 390px (Spanish): four links plus "Más", labels hyphenated correctly; the menu blurs the page behind it.
- Admin at 375px: three links plus "More" with the other five links inside. At 768px all eight links fit on screen with no sideways scroll and are 56px tall. At 1280px a centred floating dock.

Not tested: a real iPhone (safe areas were checked only through the CSS), Safari and Firefox.

**Risks and follow-ups.** Low. Next stage: notifications and confirmation dialogs.

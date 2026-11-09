# UI redesign, stage 1: design system foundation (issue #23)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #23 / see the pull request for this branch
- **Branch:** `style/ui-design-foundation` (from `develop`)
- **Type and scope:** style(frontend)
- **Files touched:** `Frontend/index.html`, `Frontend/src/index.css`. No reserved files.

**What and why.** First stage of the "NASA purple + light glass" redesign. It adds the shared design tokens every later stage uses, and a few global improvements. Presentation only.
- **Font.** Inter (400, 500, 600, 700) from Google Fonts, with the system font as a fallback. Many screens already asked for a font (`font-poppins`) that was never loaded, so they fell back to the browser default; now every screen uses Inter.
- **Colours.** A full violet scale (`brand-50` to `brand-950`) built around the original NASA purple. `brand` itself is unchanged. Neutral tokens: `ink` (text), `ink-muted`, `canvas` (page background with a faint violet tint), `line`.
- **Depth and shape.** Tokens for card radius, card shadow, floating shadow and a soft easing curve.
- **Glass.** Two utilities, `glass-violet` and `glass-light`, for navigation and floating controls only. Each has a solid fallback for browsers without blur, for "reduce transparency", and a stronger version for "increase contrast".
- **Accessibility.** A visible keyboard focus ring on every focusable element (not shown on mouse or touch), a violet text selection colour, and "reduce motion" support. Animations and transitions are cut, except loading spinners so progress stays visible.
- **Phones.** `viewport-fit=cover` so the next stage can respect the iPhone notch and home bar, and a `theme-color` so the phone browser bar matches the brand.

**Not changed.** No component, route, API call, text or business rule. Pay, prices and Excel screens are untouched.

**Database.** None. **Dependencies.** None (the font is a stylesheet link, not a package). **Config.** None. **Money impact.** None.

**Tested.** `npm run build` succeeds. In a browser (local synthetic data, no real data) Inter loads and is used by the page, and the page background uses the new canvas colour. Not tested here: the glass utilities on screen (first used in stage 2).

**Risks and follow-ups.** Low. The page now loads a font from Google Fonts. If that is ever blocked, the system font is used. Next stage: floating glass navigation.

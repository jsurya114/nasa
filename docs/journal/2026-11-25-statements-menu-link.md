# Admin menu: bring back the Statements link for the super admin

| Field | Value |
|---|---|
| Date | 2026-11-25 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR); reverses the menu part of #262 |
| Branch | `feat/statements-menu-link` (from `develop`) |
| Type / scope | `feat(ui)` |
| Files touched | `Frontend/src/reuse/Nav.jsx`, `Frontend/src/reuse/NavStatements.test.jsx`, `Frontend/src/routes/admin/SuperAdminRoute.test.jsx`, this entry. |
| Reserved files touched | None. |

**What and why.** The "Statements" tab was taken out of the menu when one GOFO upload started to carry driver work and revenue (#262). The page `/admin/carrier-statements` still exists and is still super admin only (route guard and API), but its only link was inside the upload result, which is easy to miss. In production a Shreveport week (9 to 15 November) stayed "estimated" because its statement was waiting for review, and the owner could not find the page. The menu now shows **Statements** after Insights, for the super admin only. A city admin does not see it.

**Decision reversed.** `NavStatements.test.jsx` used to assert that there is no Statements tab. That test now asserts the opposite for the owner and keeps "no Statements or Insights tab" for a city admin. Jasil, please confirm you are fine with bringing the tab back.

**Database.** None. **Config and dependencies.** None (the icon `FileCheck` is already in `lucide-react`). **Money impact.** None: a menu link only; the page and its checks are unchanged.

**Tested.** Frontend suite 637 passed, `npm run build` ok; the two menu tests cover owner (link present) and city admin (absent). **Not tested:** the look of the tab bar with one more tab on a phone (the bar already folds extra tabs under "More"), on production.

**Risks and follow-ups.** None. Frontend goes live through Vercel after a release to `main`.

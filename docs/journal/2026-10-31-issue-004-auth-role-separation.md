# Keep driver and admin sign-ins in their own areas

Legacy ID: J-004

| Field | Value |
|---|---|
| Date | 31 October 2026 |
| Author | Jayasoorya Suryadas, with Claude Code |
| Branch / PR | `fix/auth-role-separation` / pull request into `develop` (issue #4) |
| Type / scope | `fix(auth)` |
| Files touched | `Backend/middlewares/requireRole.js` (new), `Backend/middlewares/adminAuth.js`, `Backend/middlewares/driverAuth.js`, `Backend/controllers/admin/adminController.js`, `Backend/controllers/driver/driverController.js` |
| Reserved files touched | None |

**What and why.** A sign-in token now works only in its own area. Driver tokens carry `role: 'driver'`. Admin routes accept only the `admin` and `superadmin` roles, and driver routes accept only the driver role. A wrong-role token gets `403 FORBIDDEN`. Both refresh endpoints also refuse a refresh token from the other area. A new shared `requireRole()` middleware does the check, so later routes can reuse it.

**Contract kept.** `req.user`, `req.admin` and `req.driver` keep their fields. Admin role names are unchanged. Driver tokens gain one field (`role`).

**Grace period.** Driver tokens issued before this change have no role. Admin tokens always had one, so a role-less token can only be an old driver token. It is accepted on driver routes only, and it still works on no admin route. These tokens die on their own within 7 days (refresh tokens last 7 days), because nothing issues role-less tokens any more. Issue #14 removes the allowance from the code.

**Database.** None.

**Config and dependencies.** None. No new environment variable.

**Money impact.** None. No Excel, pay or dashboard file was touched.

**Tested.** A throwaway script (not committed) ran the real middleware against a local Redis: admin and superadmin tokens on admin routes (200), driver token and old role-less token on admin routes (403), driver and old role-less tokens on driver routes (200), admin and superadmin tokens on driver routes (403), no token (401), and a refresh token from the wrong area on each refresh endpoint (401). All 12 passed. The same script failed 4 of 12 on the code before this change. Not tested: a full login and refresh with a real database, and the frontend in a real browser.

**Both-session browsers.** After review (Jasil, PR #36) the frontend fix from issue #9 (PR #43, J-008) is merged into this branch. It makes each request use its own area's tokens, so a browser holding both an admin and a driver session no longer sends the admin token on driver pages. Verified on this branch: 16 checks with both sessions open (normal requests, expired driver token, expired admin token, failed driver refresh, no driver refresh token while an admin one exists) and the original 12 role checks, all passed.

**Risks and follow-ups.**
- PR #43 is a prerequisite. If #43 is merged first, this branch carries no extra frontend change; if this is merged first, #43 becomes empty. Either order works.
- Issue #14 removes the role-less allowance after 7 days in production.

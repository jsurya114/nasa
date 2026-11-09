# Logout with an expired access token revokes the whole session (review fix for PR #47)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #8 / #47 (follow-up to `2026-10-31-issue-008-refresh-token-secret-and-logout.md`)
- **Branch:** `fix/refresh-token-secret-logout`
- **Type and scope:** fix(auth)
- **Files touched:** `Frontend/src/redux/slice/axiosInstance.js`, `Backend/controllers/admin/adminController.js`, `Backend/controllers/driver/driverController.js`. No reserved files.

**What and why.** Jasil's review found a gap. When the access token has expired, the app refreshes the session by itself and repeats the logout. The repeated logout still carried the old refresh token, so the old one was revoked while the new one, issued a moment before, stayed valid.

Now, when a logout request triggers an automatic refresh, the app sends the new refresh token and also the one it replaced (`previousRefreshToken`). The server revokes both. Each token still has to belong to the person logging out (same id and same role), so someone else's token in either field is ignored. Older apps that send only `refreshToken` work as before.

**Database.** None.

**Config and dependencies.** None. Request body of the logout route gains an optional field `previousRefreshToken`.

**Money impact.** None.

**Tested.** Throwaway scripts (not committed), with the real interceptor file, the real controllers and auth middleware, a real local Redis and a stubbed database:
- Driver and admin, access token expired: logout answers 200, a new refresh token was issued during it, and both the original and the new refresh token are refused afterwards.
- Another driver's token sent as `previousRefreshToken` is not revoked.
- The earlier logout checks (ordinary logout, ownership, junk values, Redis down) still pass.
The test found one mistake in the first version: the repeated request kept the old body length. It is fixed in the same change (the length header is cleared on the repeat).
Not tested: the screens in a real browser.

**Risks and follow-ups.** None known beyond those in the first entry for this issue.

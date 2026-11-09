# Separate refresh-token secret and revoke tokens on logout

| Field | Value |
|---|---|
| Date | 31 October 2026 |
| Author | Jayasoorya Suryadas, with Claude Code |
| Issue / PR | `#8` / pull request into `develop` |
| Branch | `fix/refresh-token-secret-logout` |
| Type / scope | `fix(auth)` |
| Files touched | `Backend/services/jwtservice.js`, `Backend/services/redis-jwt-service.js`, `Backend/controllers/admin/adminController.js`, `Backend/controllers/driver/driverController.js`, `Backend/app.js`, `Backend/.env.example` (new), `Frontend/src/redux/slice/admin/adminSlice.js`, `Frontend/src/redux/slice/driver/driverSlice.js` |
| Reserved files touched | None |

## Before this reaches production

**Set `REFRESH_TOKEN_SECRET` on the backend host first.** Use a long random value that is different from `JWT_SECRET`. Create one with:

`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

The backend now **refuses to start** if `REFRESH_TOKEN_SECRET` is missing or equal to `JWT_SECRET`, with a clear message. Deploying this code without the setting means the backend does not come up. Also confirm which branch the backend host deploys from: if it deploys `develop`, set the variable before merging this pull request.

**Everyone signs in once after the deploy.** Refresh tokens issued before it were signed with the access secret and no longer verify. Access tokens still work for up to 15 minutes, then the app asks for sign-in.

## What and why

1. **A refresh token has its own secret.** `generateRefreshToken` and `verifyRefreshToken` no longer fall back to `JWT_SECRET`. A refresh token can now never be accepted as an access token, and an access token can never be used to refresh. `assertAuthSecrets()` runs once at start-up (in `app.js`, after the settings are loaded) and stops the server if either secret is missing or both are the same.
2. **Logout revokes the refresh token too.** Before, only the access token was revoked, so a stolen refresh token kept working for its full 7 days. The app now sends its refresh token in the logout request body. The server revokes it only if it belongs to the person logging out (same ID and same area); someone else's token or junk is ignored and logout still succeeds.
3. **Refresh checks the revoked list.** Both refresh endpoints refuse a refresh token that was revoked at logout.
4. **Revoked for the token's remaining life.** `blackListToken` used a fixed 1 hour. A 7 day refresh token would have been usable again after an hour. It now stays on the list until the token expires (about 7 days for a refresh token, 15 minutes for an access token).
5. **Redis problems no longer crash the server.** The old revoke calls were not awaited, so a Redis error ended the whole Node process. They are now guarded: the failure is logged and logout still answers.
6. `Backend/.env.example` lists the names of every setting the backend reads, with no values.

Older app versions that send no refresh token at logout still log out as before (the access token is revoked).

**Not done here.** Refresh tokens are not rotated (the old one is not revoked when a new one is issued). If Redis is down, revoked tokens are accepted (`isTokenRevoked` still fails open). Both are separate follow-ups.

**Database.** None.

**Config and dependencies.** New required setting `REFRESH_TOKEN_SECRET` (see above). No new packages.

**Money impact.** None. No Excel, pay or dashboard file was touched.

**Tested.** A throwaway script (not committed) ran the real middleware and controllers against a real local Redis, with only the database call stubbed. 26 checks passed: the start-up check refuses a missing or shared secret; with no refresh secret no refresh token is minted; a refresh token as a Bearer token and an access token as a refresh token are both refused; driver and admin logout revoke both tokens; the refresh token stays revoked about 7 days (604800 s) and the access token about 15 minutes (900 s); a driver cannot revoke another driver's refresh token and an admin cannot revoke a driver's; logout with no body still works; junk values (text, a number, an object, an array, empty) give 200 with no crash; and with Redis shut down logout still answers and the process stays alive. On the old code 5 checks failed (the refresh token still worked after logout for admin and driver, the revoke time was a fixed 3600 s, and a refresh token minted without its own secret worked as an access token) and the process crashed when Redis was unavailable. The frontend builds. Not tested: a real browser logout, and a real database.

**Risks and follow-ups.**
- The one-time sign-in and the start-up refusal above. This is the main risk.
- Issue #14 still needs to remove the old role-less driver token allowance.
- Rotating refresh tokens and failing closed when Redis is down are not part of this issue.

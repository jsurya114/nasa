# Strict login rate limits

| Field | Value |
|---|---|
| Date | 31 October 2026 |
| Author | Jayasoorya Suryadas, with Claude Code |
| Issue / PR | `#10` / pull request into `develop` |
| Branch | `fix/login-rate-limit` |
| Type / scope | `fix(auth)` |
| Files touched | `Backend/middlewares/loginRateLimit.js` (new), `Backend/routes/adminRoutes.js`, `Backend/routes/driverRoutes.js`, `Backend/app.js`, `Backend/locales/backend/en.js`, `Backend/locales/backend/es.js` |
| Reserved files touched | None |

## After this reaches production: set `TRUST_PROXY`

If the backend runs behind the host's proxy (the code mentions Render), set **`TRUST_PROXY=1`** on the backend host. It is the number of proxies in front of the app. Without it every user looks like the same address, which weakens the per-address limit and also makes the existing app-wide limit (1000 requests per 15 minutes) shared by everyone. Check first that there is exactly one proxy hop (no extra CDN in front); with the wrong number the address is wrong. `Backend/.env.example` (added in PR #47) should get a `TRUST_PROXY=` line once that pull request is merged.

The login limit is built so that it **cannot lock everyone out** even if `TRUST_PROXY` is not set (see below).

## What and why

Nothing limited password guessing on the two login routes. After 5 wrong passwords, the 6th attempt with the right password worked normally. The only limit was the global one (1000 per 15 minutes, in memory).

`POST /admin/login` and `POST /driver/login` now have their own strict limits (separate counters per area), per 15 minutes:

- **Per account:** at most 5 attempts for one email from one address.
- **Per address:** at most 50 failed attempts from one address, over all emails.
- A successful login clears the account counter and gives the address count back, so normal use is never limited.
- Blocked requests get `429` with a `Retry-After` header and a clear message in English or Spanish ("Too many login attempts. Please try again in 15 minutes.").
- Counters are kept in Redis, so they survive a restart. If Redis is unavailable they fall back to memory for that moment instead of switching off.

**Shared address safety.** Behind a proxy the address Express sees is the proxy's. If `TRUST_PROXY` is not set and the request carries `X-Forwarded-For`, the per-address limit is skipped (only the per-account limit applies), so one attacker cannot lock every user out. When `TRUST_PROXY` is set, the real client address is used for both limits. `app.js` also logs a warning at start-up in production when it is not set.

**Database.** None.

**Config and dependencies.** New optional setting `TRUST_PROXY` (number of proxies, default 0). No new packages.

**Money impact.** None. No Excel, pay or dashboard file was touched.

**Tested.** A throwaway script (not committed) used the real admin and driver routers and real login handlers, a real local Redis, real bcrypt password hashes, and only the database lookup stubbed. 20 checks passed:
- 5 wrong passwords answered normally, the 6th blocked even with the right password, with `Retry-After` 900 s and the message in English and Spanish
- another driver from the same address unaffected; allowed again after the window
- a good login resets the counter; admin and driver count separately
- 50 failed attempts from one address with different emails are answered, the 51st is blocked
- proxy not configured: 80 failed attempts block nobody by address, a real user still signs in, and a single account is still protected
- `TRUST_PROXY=1`: the attacking address is blocked, a different client address and the same account from another address are not
- with Redis shut down the limit still works from memory
On the old code the 6th attempt with the right password simply logged in (no limit). Not tested: the login screens in a browser, and a real proxy.

**Risks and follow-ups.**
- Per-account counting uses email plus address, so an attacker using many addresses can still try one account more than 5 times in total. A global per-account cap is a possible later step; it also makes it easy to lock a victim out, so it was not added.
- A genuine driver who mistypes 5 times is blocked for up to 15 minutes. The message says how long.
- The per-address limit and the app-wide limit are only accurate once `TRUST_PROXY` is set correctly in production.

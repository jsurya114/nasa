# One small logger, part 1: the logger itself and the app, middleware and token service (issue #18)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #18 / see the pull request for this branch
- **Branch:** `refactor/logger-core`
- **Type and scope:** refactor(backend)
- **Files touched:** `Backend/utils/logger.js` (new), `Backend/app.js`, `Backend/config/redis.js`, `Backend/middlewares/{adminAuth,driverAuth,errorHandler,loginRateLimit,superAdminAuth,validateCityType}.js`, `Backend/utils/backendI18n.js`, `Backend/services/redis-jwt-service.js`, `Backend/.env.example`. No reserved files.

**What and why.** Issue #18 asks for one logger that never prints request bodies or passwords, used instead of `console.log`, one module per pull request. This is the first one: the logger and the places every request passes through.

`Backend/utils/logger.js` gives `logger.error / warn / info / debug (message, extra)`:
- Values under keys that look sensitive (password, token, secret, authorization, cookie, session, body, email, phone, access code, api key, signature, credential, otp) are replaced by `[redacted]`, at any depth and in any letter case.
- An `Error` is reduced to its name, message and code, so a request body or settings attached to an error object are never printed. The stack is printed only at level `debug`.
- Long text is cut, long lists and deep objects are shortened, circular objects are handled, and the logger never throws.
- Every line has the time, the level and a short message.
- `LOG_LEVEL` (`error`, `warn`, `info`, `debug`) sets what is printed. If it is not set: `info` in production, `debug` everywhere else. (New setting name, listed in `.env.example`; optional.)

**What changed at the call sites (17 calls).** Request lines in `app.js` now read `POST /admin/login` with the time added by the logger (the query string was never printed there). The start-up messages, the Redis connection error, token-revoked and sign-in failure messages, the rate-limit fallback, the city-type checks and the missing translation warning use the logger with the right level. The error handler no longer prints the query string of the failing request (it printed the full URL before, which can contain search words or emails); it prints the path only. Per-request chatter (driver id and city type checks, "token added to the revoked list") is now level `debug`, so it disappears in production by default.

**Not changed.** What the code does. Messages are shorter and no longer carry emoji.

**Database.** None. **Dependencies.** None. **Money impact.** None.

**Tested.** Throwaway scripts (not committed):
- Logger unit checks (13): secrets under any key, depth or case are redacted while harmless fields stay; an error carrying a request body prints only name and message; the stack appears only at `debug`; `LOG_LEVEL` and the production default work; it does not throw on circular, symbol, function, bigint, invalid date, buffer, huge, deep, null-prototype or hostile objects; line format.
- The real app was started and sent requests carrying a password in a body, an email and a token in the query string, bearer tokens that fail, and an unknown URL: the log shows only method and path lines and short warnings, and none of the secrets (0 matches). The earlier refresh-token and login-limit suites still pass.
Not tested: the production host.

**Observation, not changed.** If Redis is down, the check "is this token revoked?" answers "no" (it logs a warning and lets the request continue). That is how it worked before this change; it is the price of keeping login working when Redis fails.

**Remaining for #18 (one pull request each, in this order).** `utils/availabilityCronJob.js` (50 banner-style lines), `controllers/driver` and `services/driver`, then `controllers/admin` and `services/admin` by module, then the frontend `console.log` calls. Files in the Excel, pay and dashboard zone are Jasil's and stay as they are. Open pull requests that touch `sanitize.js` and the routes are avoided until they merge.

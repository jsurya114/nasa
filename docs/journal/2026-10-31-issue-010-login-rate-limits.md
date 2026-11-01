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

## Before this reaches production: set `TRUST_PROXY`

**The backend now refuses to start in production unless `TRUST_PROXY` is set** to the number of proxies in front of the app: `1` behind a single hosting proxy (the code mentions Render), `0` if the app is reached directly. Check the real number first: with the wrong number the client address is wrong, and behind a proxy every user would look like one address, so 50 failed attempts from anyone would block everyone for 15 minutes. If the backend host deploys `develop`, set it **before** merging. `Backend/.env.example` (added in PR #47) should get a `TRUST_PROXY=` line once that pull request is merged.

## What and why

Nothing limited password guessing on the two login routes. After 5 wrong passwords, the 6th attempt with the right password worked normally. The only limit was the global one (1000 per 15 minutes, in memory).

`POST /admin/login` and `POST /driver/login` now have their own strict limits (separate counters per area), per 15 minutes:

- **Per account and address:** at most 5 attempts for one email from one address.
- **Per account, any address:** at most 20 attempts for one email. Stops an attack spread over many addresses. It is higher on purpose, so a stranger cannot easily lock a real user out.
- **Per address:** at most 50 failed attempts from one address, over all emails. IPv6 addresses count by their /64.
- A successful login clears the account counters and gives the address count back, so normal use is never limited.
- Blocked requests get `429` with a `Retry-After` header and a clear message in English or Spanish ("Too many login attempts. Please try again in 15 minutes.").
- Counters are kept in Redis, so they survive a restart. If Redis is unavailable they fall back to memory for that moment instead of switching off.

**The address cannot be faked.** It is always `req.ip`, built by Express from `TRUST_PROXY`. Nothing the client sends decides whether a limit applies. (An earlier version of this branch skipped the address limit when a request carried `X-Forwarded-For`. The automated security review of the pull request flagged that a client could add that header to switch the limit off. A probe confirmed it: 80 guesses were blocked 30 times without the header and 0 times with it. It was removed.)

**Database.** None.

**Config and dependencies.** New required setting in production `TRUST_PROXY` (number of proxies, `0` if none). No new packages.

**Money impact.** None. No Excel, pay or dashboard file was touched.

**Tested.** A throwaway script (not committed) used the real admin and driver routers and real login handlers, a real local Redis, real bcrypt password hashes, and only the database lookup stubbed. 28 checks passed:
- 5 wrong passwords answered normally, the 6th blocked even with the right password, with `Retry-After` 900 s and the message in English and Spanish
- another driver from the same address unaffected; allowed again after the window
- a good login resets the counter; admin and driver count separately
- 50 failed attempts from one address with different emails are answered, the 51st is blocked
- a made-up `X-Forwarded-For` (different each time) does not switch off the address limit or the account limit
- `TRUST_PROXY=1`: the attacking address is blocked, a different address and the same account from another address are not
- 20 attempts at one account from 20 addresses are answered, the 21st is blocked; other accounts are not affected
- IPv6: 50 failures from one /64 block another address in the same /64, a different /64 is unaffected
- start-up check: production with `TRUST_PROXY` unset or `abc` is refused; `1` and `0` start; development starts without it
- with Redis shut down the limit still works from memory
On the old code the 6th attempt with the right password simply logged in (no limit). Not tested: the login screens in a browser, and a real proxy.

**Risks and follow-ups.**
- Anyone can lock a known account out for up to 15 minutes by sending 20 wrong guesses from many addresses, or 5 from one. The limits are as high as is useful to keep this hard to do; a CAPTCHA or a slow-down instead of a hard block is a possible later step.
- A genuine driver who mistypes 5 times is blocked for up to 15 minutes. The message says how long.
- The per-address limit and the app-wide limit are only accurate once `TRUST_PROXY` is correct in production. The app must not be reachable directly, bypassing the proxy.

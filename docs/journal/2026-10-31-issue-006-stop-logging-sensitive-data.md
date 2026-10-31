# Stop logging passwords, tokens and request data

Legacy ID: J-006

| Field | Value |
|---|---|
| Date | 31 October 2026 |
| Author | Jayasoorya Suryadas, with Claude Code |
| Branch / PR | `fix/stop-logging-sensitive-data` / pull request into `develop` (issue #6) |
| Type / scope | `fix(security)` |
| Files touched | `Backend/app.js`, `Backend/services/admin/dbQueries.js`, `Backend/services/redis-jwt-service.js`, `Backend/utils/availabilityCronJob.js`, `Frontend/src/redux/slice/admin/userLoadSlice.js`, `Frontend/src/redux/slice/driver/passwordSlice.js`, `Frontend/src/redux/slice/axiosInstance.js` |
| Reserved files touched | None |

**What and why.** Logs must never hold passwords, tokens, personal data or whole request bodies. Searched every live `console` call in the backend and the sign-in related ones in the frontend. Removed or trimmed these:

- Backend `dbQueries.js`: removed the log of the whole driver update object (it held the plain password, email and phone).
- Backend `redis-jwt-service.js`: the logout log no longer prints the access token.
- Backend `app.js`: the request log for `/admin` and `/driver` now prints only the method and path, with no query string and no part of the `Authorization` header.
- Backend `availabilityCronJob.js`: the weekly reset log lists driver IDs, not names and driver codes.
- Frontend `userLoadSlice.js`: removed the two logs of the "add driver" and "add admin" form (they held the plain password).
- Frontend `passwordSlice.js` and `axiosInstance.js`: log the error message only, not the whole axios error (it carries the request body: the passwords or the refresh token).

**Left alone on purpose.**
- Other frontend `console.log` calls (route, job and delivery data). They hold no secrets. Issue #18 (one small logger) removes them.
- Backend `dashboardQueries.js` (Jasil's zone) prints the payment update query and its values, which include the driver's name. Passed to Jasil to remove in his own work (issue #24 or #26).

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None. Only log lines changed, and no Excel, pay or dashboard file was touched.

**Tested.** A throwaway script (not committed) captured what the real code prints. It ran the real `updateDriver` with a password, email and phone, the real token blacklist, and the real `app.js` as a child process with a request carrying a token and an email in the query string. All 7 checks passed, and 6 of them failed on the code before the change. Syntax checked on every changed backend file. Not tested: the frontend in a browser.

**Risks and follow-ups.** Existing logs on the server may already hold old values from before this change. Consider clearing or rotating those logs, and treat any password that was in them as exposed. Issue #18 will add a logger that redacts by default.

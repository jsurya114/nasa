# Send each request's own sign-in token

Legacy ID: J-008

| Field | Value |
|---|---|
| Date | 31 October 2026 |
| Author | Jayasoorya Suryadas, with Claude Code (requested in Jasil's review of PR #36) |
| Branch / PR | `fix/token-by-app-area` / pull request into `develop` (issue #9) |
| Type / scope | `fix(frontend)` |
| Files touched | `Frontend/src/redux/slice/axiosInstance.js`, `docs/JOURNAL.md` |
| Reserved files touched | None |

**What and why.** The browser app chose its token with "admin token if present, else driver token". A browser that held both an admin and a driver session therefore sent the admin token on driver pages, and refreshed the wrong session. Once the server enforces roles (PR #36, issue #4) driver requests would be refused. Now each request uses the tokens of its own area.

- The area comes from the request URL (`/admin/...` or `/driver/...`), and from the page only if the URL does not say.
- The request uses `<area>Token`. A 401 refreshes with `<area>RefreshToken` through `/<area>/refresh-token`, and stores the new pair under the same area.
- If a refresh fails, only that area is signed out and the user goes to that area's login page. The other session is kept. Before, all four tokens were cleared.
- The refresh failure log prints the error message only (same line as PR #38).

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None. No Excel, pay or dashboard file or screen was touched.

**Tested.** A throwaway script (not committed) ran the real interceptor file against the real backend middleware and refresh endpoints, with the database stubbed and a local Redis. 16 checks cover: both sessions open, an expired driver token, an expired admin token, a failed driver refresh, a driver with no refresh token while an admin refresh token exists, single sessions, and no session. Results:
- #36 backend with the old interceptor: 7 failed (driver requests got 403 when both sessions existed).
- #36 backend with the new interceptor: all 16 passed.
- current `develop` backend with the new interceptor: all 16 passed (no regression).
Not tested: a real browser, and a real database.

**Risks and follow-ups.** Merge this before or together with PR #36. The two lines in `console.error(...)` and this file overlap with PR #38, so whichever merges second needs a one-line conflict check. Nothing else reads the stored tokens directly.

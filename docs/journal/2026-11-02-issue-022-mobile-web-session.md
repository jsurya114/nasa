# Mobile app, step 3: session adapter, tokens in memory inside the app (issue #22)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #22 / see the pull request for this branch
- **Branch:** `feat/mobile-web-session` (built on `feat/mobile-web-bridge`; merge that pull request first)
- **Type and scope:** feat(frontend)
- **Files touched:** new `Frontend/src/native/sessionStore.js`; `Frontend/src/redux/slice/axiosInstance.js`, `driver/driverSlice.js`, `admin/adminSlice.js`. No reserved files.

**What and why.** Implements the session design in `docs/MOBILE_APP_DESIGN.md` (section 3). All token reading and writing now goes through one module, `sessionStore.js`:
- **In a normal browser nothing changes.** Tokens stay in `localStorage` under the same four names, and the refresh and logout calls are the same.
- **Inside the mobile app** the shell keeps the refresh token in secure storage. The page keeps only the access token, in memory, and writes neither token to `localStorage`. Sign-in sends the tokens once with `session.set`. On a `401` the page asks the shell with `session.refresh`; several failing requests share one refresh, and a request that failed before another one refreshed just retries with the newer token. Logout is `session.clear`, and the shell revokes the refresh token on the server.
- A failed check in the app (for example no connection) no longer clears the session; only a `401` or `403`, or a failed refresh, signs the person out. In a browser the old behaviour (clear on any failed check) is kept.
- If the shell cannot store the session at sign-in, sign-in fails with "Could not sign in on this device".

**Needs from the shell.** `session.clear` must refresh to a valid access token, call `POST /<area>/logout` with the refresh token, then wipe its copy.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** `eslint` and `vite build`: clean. Plain browser, local driver: sign-in stores both tokens in `localStorage` and opens the dashboard as before. App mode with a fake shell (a script that holds the refresh token and calls the real local backend): sign-in leaves **no token in `localStorage`** and the shell holds the refresh token; with an invalid access token a request returns 200 after the shell refreshed it and the refresh token rotated; three simultaneous failures caused one refresh and all returned 200; logout made the shell call the server logout (200) and wipe its copy, and the old refresh token was then refused (401).

**Not tested.** A real shell or phone. Admin sign-in in app mode (same code path as the driver's, driver was exercised). Restart restoring a session (`session.get` with a real stored session). A refresh failing in app mode and redirecting to login. After a network error the route guard still shows the login screen for that visit, although the session is kept, and the next start restores it. No frontend test framework exists.

**Risks and follow-ups.** Medium: it touches sign-in for both areas. The browser path was kept identical, but the reviewer should sign in and out as a driver and an admin, and let a session refresh after 15 minutes. Next: the Expo shell.

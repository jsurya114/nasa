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

**Sign-out safety (from the automated security review of this PR).**
- A refresh that is still running when someone signs out (or signs in again) can no longer put a token back: each area has a counter that goes up on sign-in and sign-out, and a slow reply from before the change is dropped.
- If the shell cannot be reached by `session.clear` (one retry), the logout reports "Signed out here, but the app could not confirm it on this phone. Please restart the app and sign out again." The page is signed out either way, so a failed clear is visible, not silent.

**Needs from the shell.** `session.clear` must wipe the refresh token from secure storage **first**, so a session cannot be restored at the next start, and only then (best effort) refresh to a valid access token and call `POST /<area>/logout` with the refresh token to revoke it on the server.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** `eslint` and `vite build`: clean. Plain browser, local driver: sign-in stores both tokens in `localStorage` and opens the dashboard as before. App mode with a fake shell (a script that holds the refresh token and calls the real local backend): sign-in leaves **no token in `localStorage`** and the shell holds the refresh token; with an invalid access token a request returns 200 after the shell refreshed it and the refresh token rotated; three simultaneous failures caused one refresh and all returned 200; logout made the shell call the server logout (200) and wipe its copy, and the old refresh token was then refused (401). After the review fixes, re-run against the app's own loaded modules: expired token refreshed (200), 3 simultaneous failures caused 1 refresh, signing out during a slow refresh rejected the in-flight request and left the shell with no session, and a failing `session.clear` was retried once and then reported as failed.

**Not tested.** A real shell or phone. Admin sign-in in app mode (same code path as the driver's, driver was exercised). Restart restoring a session (`session.get` with a real stored session). A refresh failing in app mode and redirecting to login. After a network error the route guard still shows the login screen for that visit, although the session is kept, and the next start restores it. No frontend test framework exists.

**Risks and follow-ups.** Medium: it touches sign-in for both areas. The browser path was kept identical, but the reviewer should sign in and out as a driver and an admin, and let a session refresh after 15 minutes. Next: the Expo shell.

## Review fixes (Jasil's review of this pull request)

Three blocking findings, all reproduced and fixed, with integration tests.

1. **Fresh app start reloaded the login page in a loop.** With nobody signed in, the access check got a 401, the shell answered `no_session`, and the interceptor redirected to the page already showing. `no_session` and `signed_out` are now ordinary "not signed in" results: no sign-out call and no redirect, so the route guard shows the form after one check. The interceptor also never redirects to a login page that is already showing, and the access check no longer sends a sign-out to the shell when there was no session to remove.
2. **A temporary failure erased the session.** Only a refresh the server refused (`refresh_failed`) now signs out. A lost connection, a server error, a bridge timeout or any other shell error keeps the session, marks the failure as temporary, and the driver and admin route guards show a translated "Can't reach NASA / Try again" screen (English and Spanish) instead of the login form. A later failed check does not sign out someone already signed in.
3. **An unconfirmed sign-out could silently come back.** When the shell cannot confirm `session.clear`, the "pending sign-out" is remembered in `localStorage` (a flag, not a credential). While it is set: the access token is never restored, refresh is refused, the access checks end without calling the server, and the sign-in screens (driver and admin) show a persistent translated "Sign-out not confirmed" notice with a Try again button. The page also tries to finish the sign-out once on every load. A successful retry, or a new sign-in, clears the flag.

**Test framework added (frontend dev dependencies).** Vitest 3, jsdom, `@testing-library/react` and `@testing-library/dom`, with `npm test` (`vitest run`) and a Tests step in the Frontend CI job. 23 tests, no network: the session store (browser and app modes, race and pending sign-out), the interceptor (fresh start, `network_error`, `server_error`, `native_error`, a silent shell timing out, `refresh_failed`, no reload on the login page, normal browser refresh and sign-out unchanged), and the real route guards, slices and notice (temporary failure then retry for driver and admin, a fresh start, and an unconfirmed driver sign-out that stays visible and is not restored). They use a fake shell and a fake server. Not covered: a real WebView or phone.

**Normal browser:** unchanged, covered by the browser-mode tests and the earlier manual sign-in.

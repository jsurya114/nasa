# Push notifications, step 4: the web side

| Field | Value |
|---|---|
| Date | 2026-11-02 |
| Author | Jasil (with Claude Code) |
| Issue / PR | `#22` / see the pull request for this branch |
| Branch | `feat/push-web-registration` (built on `feat/push-app-and-web`; merge that and the pull requests below it first) |
| Type / scope | `feat(frontend)` |
| Files touched | New: `Frontend/src/native/push.js`, `PushSetup.jsx`, `PushTapRouter.jsx`, `push.test.jsx`, `pushTap.test.jsx`. Edited: `native/bridge.js` (five action names), `native/sessionStore.js` (a sign-out hook), `hooks/translation.js` (four strings, English and Spanish), `routes/driver/DProtectedRoutes.jsx`, `routes/admin/ProtectedRoute.jsx` and `App.jsx` (one component each) |
| Reserved files touched | None of the Excel, pay and dashboard zone. The sign-in files (`sessionStore.js`, the route guards) are the mobile parts of sign-in, which are Jasil's under `docs/OWNERSHIP.md`. |

**What and why.** Sections 3, 5 and 10 of `docs/MOBILE_APP_DESIGN.md`: the page half of push. Everything is inert in a normal browser and in an app build that has no push support.
- **Asking, in context.** After sign-in (`PushSetup`, inside the driver and admin route guards, so never before sign-in) the page asks the shell about push. If the phone cannot get a token (a simulator, or no Expo project yet) nothing happens. If notifications are already allowed, the phone is registered quietly. If the answer is still open, our own short explanation appears first ("Turn on notifications?", English and Spanish); only **Turn on** shows the system prompt. **Not now** asks nothing further for 7 days. If the person refuses, nothing is registered and the app works as before.
- **Registering.** The token comes from the shell (`push.getToken`); the page sends it with the platform and shell version to `POST /<area>/push-token`, with the person's own access token, so the server takes the person from the token. The request uses a plain client with no interceptors, so a failure (including a `401`) can never trigger a refresh or a sign-out, and it is silent: the next start tries again.
- **Signing out.** `sessionStore` gained `onSignOut(hook)`. At the start of an in-app sign-out the hook receives the area and the access token the page still holds, and `PushSetup` sends `POST /<area>/push-token/remove` with it. It is not waited for and its failure is ignored, so signing out is never delayed or blocked; a sign-out of the other area removes nothing. This covers the normal logout and the other in-app sign-out paths. When the session is already dead (an expired refresh token), the removal cannot be authorised and the phone stays registered to that person until the same phone is used to sign in (the server then moves it to the new person) or Expo reports the token invalid. Lock-screen text is generic and a tap checks sign-in, so the exposure is small.
- **Tap routing (`PushTapRouter`).** On the shell's data-free nudge (and once at start, for a tap that opened the app from closed) the page collects the screen name through the bridge and maps it per area: driver `availability`, `deliveries`, `agreement`; admin `access-codes`. A name not listed for the signed-in area, or any URL, is ignored. If nobody is signed in yet the tap waits up to 10 minutes for a sign-in. If someone is signed in whose area cannot open it, it is dropped and does not follow a later sign-in. The route guards (agreement, role, sign-in) and the server still decide what is shown.

**Database.** None.

**Config and dependencies.** None. Four translation keys in both languages.

**Money impact.** None.

**Tested.**
- `npm test` in `Frontend/`: 60 of 60 pass (the earlier suite plus 26 new). New tests use the real components with the fake shell and fake server: nothing happens in a browser, without the capability, on a phone that cannot get a token, or with no session; quiet registration for the right area with the person's token and the right body; a failed or `401` registration is silent and triggers no refresh or sign-out; the explanation comes first and the system prompt only after "Turn on"; "Not now" asks nothing and is not repeated within a week (and is again after one); a system "no" registers nothing; sign-out sends the removal with the token the page held, for the right area, without waiting for it (a removal that never answers does not block the sign-out); another area's sign-out removes nothing; a browser sign-out sends nothing; tap routing for each screen name, a cold-start tap, a wait for sign-in, expiry after ten minutes, a screen the area cannot open, hostile names (`https://...`, `/admin/dashboard`, `__proto__` and others), non-tap events, and no calls without the capability.
- Mutation checks: removing the sign-out hook, routing a raw name, always re-asking and ignoring the area in the removal each make tests fail.
- `eslint` is clean on the files touched; `vite build` succeeds.
- Local note: the test suite needs a Node with zstd support for its test environment; the machine had only Node 22.12, so the run used Node 26 with `NODE_OPTIONS=--no-experimental-webstorage` (CI uses the current Node 22).
- **Not tested:** inside the real app or a real browser tab, on a phone, with a real token or a real notification. The page was never connected to the real shell code (only a fake of it). The prompt's look and touch size were not checked on a device.

**Risks and follow-ups.** There is no "notifications are off, open settings" screen yet (the shell action `push.openSettings` exists); a person who refused must find the phone's settings themselves. Account-level on/off switches per event are left for later. The design's note on logout cleanup is met on the normal path only, as described above.

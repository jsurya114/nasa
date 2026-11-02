# Mobile app, step 5: WebView container, secure session and bridge host (issue #22)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #22 / see the pull request for this branch
- **Branch:** `feat/mobile-shell-webview` (built on `feat/mobile-shell-protocol`; merge that and the pull requests below it first)
- **Type and scope:** feat(mobile)
- **Files touched:** `mobile/` only (`App.js`, `src/session.js`, `src/bridge/host.js`, `src/config.js`, `src/native/*`, `src/screens/ErrorScreen.js`, tests, config, README). Nothing in `Frontend/` or `Backend/`. No reserved files.

**What and why.** The working shell described in `docs/MOBILE_APP_DESIGN.md`:
- **Secure session (`session.js`).** The refresh token is kept only in the phone's secure storage (iOS Keychain, Android Keystore; on iOS not synced or backed up). The access token is kept in memory. Refresh rotates the stored token; simultaneous refreshes share one call. A refused refresh token (expired, revoked, wrong role) ends the session; a lost connection does not. Sign-out **wipes the stored token first**, then revokes it on the server in the background, so a session can never come back at the next start. A refresh that is still running when someone signs out is dropped.
- **Bridge host (`host.js`).** Answers only a page whose address is exactly the NASA web origin (any other page gets no reply at all), then runs the checks from the protocol file. Implemented actions: `app.hello`, `session.get`, `session.set`, `session.refresh`, `session.clear`, `link.openExternal`. Errors go back as short codes only.
- **WebView container (`App.js`).** Loads only the configured web origin. Navigation or frames to any other origin are blocked, and a tapped link to another website opens outside the app (`https`, `mailto`, `tel` only), so no outside page can sit next to the bridge. The bridge is injected into the main frame only, and each page load gets a new random secret (`window.__NASA_BRIDGE_NONCE__`, from `expo-crypto`) that every message must carry; a message without it gets no answer, so a frame from another site cannot use the bridge even where Android exposes the bridge object to frames (found by an automated security review; the WebView has no main-frame-only switch for messages). File access, popup windows, mixed content and third-party cookies are off; WebView debugging is on only in `development`. Android Back goes back inside the web app first. A crashed WebView process reloads. A load error shows the no-connection screen and a 5xx shows the server-unavailable screen, each with a Try again button. Nothing is queued or saved while those screens show.
- **Safe areas.** The shell pads the top (below the status bar, on NASA purple); the web app owns the bottom through `env(safe-area-inset-bottom)`. The design document was updated to say this. To be confirmed on real devices.
- Added with `npx expo install`: `react-native-webview` 14.0.1, `expo-secure-store`, `expo-constants`, `expo-crypto`, `react-native-safe-area-context`.

**Database.** None. **Config.** No new variables beyond those in the previous pull request. **Money impact.** None.

**Tested.** `npm test` in `mobile/`: 33 of 33 pass (14 protocol, 10 session, 9 bridge host), using fakes for storage and network: rotation, single-flight refresh, refused token ends the session, offline keeps it, sign-out wipes before touching the network and still works offline, sign-out during a refresh, a page from another origin gets nothing, unsupported actions and bad payloads never run anything, replayed ids, errors never leak messages. `npx expo export` bundles for iOS and Android; `npx expo-doctor`: 20 of 20 checks pass.

**Not tested (important).** The app has **not run on a simulator or a phone**. So not yet verified: the real WebView, the actual `onMessage` URL value on iOS and Android, whether the nonce really keeps a cross-origin iframe out on Android (the page injected before content loads only in the main frame), keyboard and safe-area behaviour, Android Back, the offline screen, the end-to-end sign-in through the web app plus this shell, session restore after a restart, text scaling, Reduce Motion. Reviewable builds on a real iPhone and Android phone are the next step.

**Risks and follow-ups.** Medium until it runs on devices. Open items: phone features (`media.pickImages`, `file.pickDocument`, `file.share`), app icons, bundle IDs and signing, EAS profiles, push notifications (decision pending), store checklist.

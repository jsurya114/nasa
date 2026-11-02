# Mobile app, step 2: web side of the native bridge (issue #22)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #22 / see the pull request for this branch
- **Branch:** `feat/mobile-web-bridge` (from `develop`)
- **Type and scope:** feat(frontend)
- **Files touched:** `Frontend/src/native/bridge.js` (new). Nothing imports it yet, so no screen changes. No reserved files.

**What and why.** First code step of `docs/MOBILE_APP_DESIGN.md` (section 4). A small module the web app will use to talk to the NASA mobile shell:
- `isNativeShell()` is true only inside the app's WebView.
- `callNative(action, payload)` sends one versioned JSON message with a random request id and waits for the reply with the same id (10 second timeout). Only the nine actions in the contract can be sent; anything else is refused before it leaves the page.
- `getCapabilities()` / `hasCapability(name)` run the `app.hello` handshake once and answer `null` / `false` outside the app or if the shell does not answer, so callers fall back to normal browser behaviour.
- Replies are accepted only if the version is 1 and the id matches a request this page is waiting for.

In a normal browser it does nothing. It is also not used by any screen yet; the session adapter is the next pull request.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** `npx eslint` on the file and `npx vite build`: clean. In Chrome with a fake `window.ReactNativeWebView`: outside the app calls reject with `not_in_app` and capabilities are `null`; replies resolve with their data; an error reply rejects with the shell's code; an unsupported action (`shell.exec`) is never sent; a silent shell times out; replies with an unknown id or version 2 are ignored; capabilities are cached and `hasCapability` is true only for listed names.

**Not tested.** A real shell, a real iPhone or Android WebView (Android delivers some events differently; the shell will answer with the custom event, which does not depend on that). Automated tests: the repo has no frontend test framework.

**Risks and follow-ups.** Low: unused code. The reply event name (`nasa-native-reply`) is part of the contract and must match the shell. Next: the session adapter (tokens in memory inside the app).

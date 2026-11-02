# Mobile app, step 4: the Expo project and the bridge rules (issue #22)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #22 / see the pull request for this branch
- **Branch:** `feat/mobile-shell-protocol` (built on `feat/mobile-web-session`, which is built on `feat/mobile-web-bridge`; merge those first)
- **Type and scope:** feat(mobile)
- **Files touched:** new folder `mobile/` (Expo project, config, bridge protocol and tests, README). Nothing in `Frontend/` or `Backend/` changes in this pull request. No reserved files.

**What and why.** Starts the shell described in `docs/MOBILE_APP_DESIGN.md`. This part is the project and the rules the shell will enforce, with no screens yet:
- **Project.** Expo SDK 58 (React Native 0.88, current at the time) created with `create-expo-app`, plain JavaScript, no Expo Router (the app will be one WebView screen). `react-native-webview` and `expo-secure-store` are added with `npx expo install` in the next pull request, so their versions match the SDK.
- **Config (`app.config.js`).** `development`, `preview` and `production` come from `APP_ENV`. The web and API origins come from environment variables; outside development they must be `https` origins with no path, or the build stops. The bundle ID and Android package are a placeholder (`com.example.nasalogistics`) until the client's developer accounts exist.
- **Bridge protocol (`src/bridge/protocol.js`).** Pure functions with 12 unit tests: size limit, JSON shape, request id format, version 1 only, only implemented actions, a strict payload shape per action (area `admin` or `driver`, token length limits, `https` only for external links), a bounded memory of used ids against replays, exact origin matching (handwritten, because React Native's `URL` lacks `origin`), an injection-safe reply script, and a **per-page-load nonce** check: a message must carry the secret the shell injected into the main frame, otherwise it gets no answer at all (added after an automated security review, because on Android the bridge object can be visible to frames from other sites). With no nonce configured, every message is refused. 14 tests now.

**Database.** None. **Dependencies.** The new `mobile/` project has its own `package.json` and lock file (Expo, React, React Native). `npm audit --omit=dev` there reports 11 moderate findings inside Expo's own dependency tree; none were added by us. No change to `Frontend/` or `Backend/` dependencies. **Config.** New variables `APP_ENV`, `NASA_WEB_ORIGIN`, `NASA_API_ORIGIN`, `NASA_APP_ID` (names and purpose in `mobile/.env.example`, no values). **Money impact.** None.

**Tested.** `npm test` in `mobile/`: 14 of 14 pass. `npx expo config` loads in development; production with an `http` origin and `APP_ENV=staging` are both refused with a clear message; production with `https` origins works. Not tested: the app has not been started on a simulator or phone; the placeholder screen is the only UI. App icons are still Expo's defaults and need real artwork.

**Risks and follow-ups.** Low. Next: the WebView container, origin allowlist, session storage in the phone's secure storage and the offline screen.

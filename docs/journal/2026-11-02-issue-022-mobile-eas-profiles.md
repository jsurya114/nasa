# EAS build profiles for the mobile app

| Field | Value |
|---|---|
| Date | 2026-11-02 |
| Author | Jasil (with Claude Code) |
| Issue / PR | `#22` / see the pull request for this branch |
| Branch | `chore/mobile-eas-profiles` |
| Type / scope | `chore(mobile)` |
| Files touched | `mobile/eas.json` (new), `mobile/app.config.js`, `mobile/app.config.test.js` (new), `mobile/package.json`, `mobile/package-lock.json`, `mobile/README.md` |
| Reserved files touched | None |

**What and why.** Step 3 of the delivery plan in `docs/MOBILE_APP_DESIGN.md` (section 12): reproducible test builds.
- `eas.json` with the three profiles from the design: `development` (development client; iOS simulator build and Android `.apk`), `preview` (release build for testers, Android `.apk`) and `production` (store build, build number raised automatically). Each sets only `APP_ENV`. Origins and the app ID are not in the file; they come from EAS environment variables or the shell, so no real address is committed.
- `app.config.js` allows plain http to a computer on the local network **only** when `APP_ENV=development`: `usesCleartextTraffic` on Android (through `expo-build-properties`) and `NSAllowsLocalNetworking` on iOS. Without this a release-style Android build cannot reach the Mac used for testing. Preview and production keep the platform default of refusing cleartext traffic.
- `app.config.test.js` (7 tests, run by `npm test` and so by the Mobile CI job) loads the real config in a fresh process for each environment and checks: cleartext on only in development, off in preview and production on both platforms, preview and production stop on an http origin, an unknown `APP_ENV` stops the build, and only production is named without its environment.

**Database.** None.

**Config and dependencies.** Added with `npx expo install` (versions match SDK 58): `expo-dev-client` (needed for a development build) and `expo-build-properties` (the cleartext switch). No new environment variables.

**Money impact.** None.

**Tested.**
- `npm test` in `mobile/`: 46 of 46 pass (39 existing, 7 new).
- `npx expo config` for each of the three environments: the plugin and the iOS setting are as described.
- `npx expo prebuild` (generated, then deleted): the Android manifest has `usesCleartextTraffic="true"` for development and `"false"` for production; the iOS Info.plist has `NSAllowsLocalNetworking` for development and `NSAllowsArbitraryLoads` false for production.
- `npx expo export` for iOS and Android bundles; `npx expo-doctor`: 20 of 20 checks pass.

**Not tested.** No build was run through EAS (no Expo account or project ID exists) and none was installed on a phone or simulator. The `eas.json` file was checked only as valid JSON, not by the EAS CLI. A cloud iOS build needs the owner's Apple account.

**Risks and follow-ups.** `expo-dev-client` adds a launcher to development builds only; preview and production are unaffected. The generated native folders are not committed. Still open: `eas init`, the real bundle and package ID, signing credentials (owner decision).

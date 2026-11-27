# Build, signing and release (iOS)

Nothing secret goes in this repository: certificates, provisioning profiles, the APNs key, App Store Connect API keys and reviewer passwords live in EAS (owner's Expo account) and App Store Connect only.

## Owner prerequisites

1. Apple Developer Program membership for the legal entity (organisation account, D-U-N-S). Team ID recorded in EAS, not here.
2. Final bundle ID, for example `com.<nasa-domain>.routes`. It cannot change after the first release.
3. Expo account and project: `eas init` gives the project ID, set as `EAS_PROJECT_ID` in EAS environment variables.
4. APNs key: let EAS create it (`eas credentials`), or upload one made in the Apple Developer portal. Push needs it.
5. Approved artwork: 1024x1024 icon (no transparency), splash image, Android foreground. Put them in `mobile/assets` (replacing Expo's) or point `NASA_ASSETS_DIR` at them. Production builds refuse Expo's placeholders.

## EAS environment variables (per profile)

| Variable | preview | production |
|---|---|---|
| `NASA_WEB_ORIGIN` | review/staging web origin, https, no path | `https://<production web origin>` |
| `NASA_API_ORIGIN` | review/staging API | `https://api.nasaroutes.com` |
| `NASA_APP_ID` | real bundle ID | real bundle ID |
| `EAS_PROJECT_ID` | project ID | project ID (required) |

`app.config.js` refuses http origins, origins with a path, the placeholder bundle ID, and (production) placeholder artwork or a missing project ID.

## Build SDK

App Store uploads must be built with **Xcode 26 / iOS 26 SDK** (required since 28 April 2026; recheck https://developer.apple.com/news/upcoming-requirements/ before submitting). EAS cloud builds pick the image from the Expo SDK; confirm the build log shows Xcode 26. The app's minimum iOS version stays Expo's default (not raised to 26).

## Commands (run by the owner or with the owner's go-ahead)

```bash
cd mobile && npm ci && npm test
```

```bash
npx eas-cli build --profile preview --platform ios
```

```bash
npx eas-cli build --profile production --platform ios
```

```bash
npx eas-cli submit --platform ios --latest
```

`submit` only uploads to TestFlight / App Store Connect; it does not release. Android builds are unchanged (`--platform android`).

## Before Submit for Review

- TestFlight build installed on at least one physical iPhone; TEST_MATRIX.md device rows filled with dates.
- Archive checked: Info.plist permissions (camera reason only; no location, microphone, Face ID, background modes), privacy report generated, no development entries, `webviewDebuggingEnabled` off.
- App Store Version Release set to **Manually release this version** (UNLISTED_REQUEST.md).

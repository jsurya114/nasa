# NASA Logistics mobile app

One iOS and Android app for drivers, city admins and super admins. It is a thin Expo / React Native shell around the hosted NASA web app. All screens, pay rules and permissions stay in the web app and the backend. Design: [docs/MOBILE_APP_DESIGN.md](../docs/MOBILE_APP_DESIGN.md).

## Run

```bash
cd mobile
cp .env.example .env     # example values only; nothing secret goes in this folder
npm install
npm test                 # bridge protocol tests (Node's built-in runner)
npx expo start
```

Build settings come from environment variables (see `.env.example`). `preview` and `production` builds refuse any origin that is not `https`. Signing keys, store credentials and real origins belong in the EAS build profile, never in the repository.

## Builds

`eas.json` has three profiles. Each sets `APP_ENV`; the origins and the app ID come from EAS environment variables (`eas env:create`) or, for a local build, from your shell.

| Profile | For | Output |
|---|---|---|
| `development` | Developers. Development client, plain http allowed to a computer on the local network | iOS simulator build, Android `.apk` |
| `preview` | Testers (staging). Release build, https only | Android `.apk` (an iOS build needs an Apple account) |
| `production` | Store submission. Release build, https only, build number raised automatically | Store binaries |

Plain http is switched on only when `APP_ENV=development`: `usesCleartextTraffic` on Android and `NSAllowsLocalNetworking` on iOS. Preview and production keep both platforms' default of refusing it: a config plugin removes the local-network entries the iOS template and the development client add, and `app.config.test.js` generates the real iOS project for each environment and checks the resulting Info.plist.

A local Android test file for a phone on the same Wi-Fi (needs the Android SDK, not an Expo account):

```bash
cd mobile
APP_ENV=development NASA_WEB_ORIGIN=http://<mac-ip>:5174 NASA_API_ORIGIN=http://<mac-ip>:5002 \
  npx eas-cli build --profile development --platform android --local
```

Not set up yet: an Expo account and project ID (`eas init`), the real bundle and package ID (`NASA_APP_ID`, still the placeholder), and signing credentials. The owner decides those later; see the design document, section 9.

## Status

Done and merged: the project, the bridge rules, the secure session store, the bridge host and the WebView container with its no-connection screen; build profiles (development, preview, production) with http allowed only in development; push notifications (permission, token registration, sign-out removal and tap routing in the shell, with the backend that registers phones and sends the four workflow notifications); the trimmed permission list; and the journey form's weak-connection handling in the web app. It has bundled for iOS and Android and passes `expo-doctor`, but **it has not run on a phone or simulator yet**.

Left: a test on a real device (sign-in and restore after a restart, keyboard, Back, background and resume, camera and file pickers, weak connection, push end to end), the Android merged release manifest, the owner's decisions and accounts (store accounts, bundle ID, Expo, Firebase, Apple push key, account deletion), the store paperwork and the artwork. The checklist with the status of each item is `docs/MOBILE_STORE_READINESS.md`. Left out on purpose: biometric unlock, offline writes, a share sheet, drafts for the access-code and agreement forms, a read-only cache, and a "notifications are off" settings screen.

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

## Status

Step 5 of the plan in the design document. Done: the project, the bridge rules, the secure session store, the bridge host and the WebView container with its no-connection screen. Next: the phone features (camera or photo picker, document picker, share sheet), reviewable builds on real devices, and the store checklist. It has bundled for iOS and Android and passes `expo-doctor`, but it has not run on a phone or simulator yet.

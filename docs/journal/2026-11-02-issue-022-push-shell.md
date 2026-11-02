# Push notifications, step 3: the shell side

| Field | Value |
|---|---|
| Date | 2026-11-02 |
| Author | Jasil (with Claude Code) |
| Issue / PR | `#22` / see the pull request for this branch |
| Branch | `feat/push-app-and-web` (built on `feat/push-sender-events`; this pull request is the shell half, the web half follows) |
| Type / scope | `feat(mobile)` |
| Files touched | `mobile/` only: `src/push.js` (new), `src/push.test.js` (new), `src/bridge/protocol.js`, `src/bridge/host.js` and their tests, `src/config.js`, `App.js`, `app.config.js`, `package.json`, `package-lock.json`, `.env.example`, `.gitignore` |
| Reserved files touched | None |

**What and why.** Sections 4 and 10 of `docs/MOBILE_APP_DESIGN.md`: the phone half of push. The web half (asking, registering, tap routing) is the next pull request; until it ships nothing calls these actions.
- **Five new bridge actions**, all with an empty payload, version 1 of the contract unchanged: `push.status` (is push available on this phone, and the permission state), `push.requestPermission` (shows the system prompt only when the answer is still undecided, or denied but the system will ask again; otherwise it just reports), `push.getToken` (the Expo push token; needs a real device, an Expo project and granted permission), `push.openSettings`, and `push.takePendingTap`. The `push` capability is advertised only by a build that has push support, so older web code and older shells keep working. The same origin check, nonce and replay rules apply; errors go back as short codes only (`push_unavailable`, `permission_denied`, `token_failed`).
- **Tap routing, by name only.** A notification carries a screen name (`availability`, `deliveries`, `agreement`, `access-codes`). The shell accepts only those four, keeps the last one, and nudges the page with a data-free event (`nasa-native-event`); the page then asks for it with `push.takePendingTap`, which returns it once. A tap that opened the app from closed is collected the same way when the page starts. A name outside the list, or a URL, is dropped. The web app's own sign-in and role checks decide what is shown.
- **Android channel** `default` is created before the token is requested (the server names it on every message). Notifications that arrive while the app is open show as a banner, without sound or badge.
- **Config.** `expo-notifications` plugin with the NASA purple as the accent colour (iOS gets the push entitlement). `EAS_PROJECT_ID` and `GOOGLE_SERVICES_FILE` are read from the environment and are optional: without an Expo project the app works and push says it is unavailable. The Firebase file is a path, never committed; `google-services.json` and `GoogleService-Info.plist` are in `.gitignore`.
- Added with `npx expo install`: `expo-notifications` and `expo-device`.

**Database.** None.

**Config and dependencies.** New optional variables `EAS_PROJECT_ID` and `GOOGLE_SERVICES_FILE` (names in `mobile/.env.example`). Packages as above.

**Money impact.** None.

**Tested.**
- `npm test` in `mobile/`: 52 of 52 pass (39 earlier, 13 new): every new action needs an empty payload; the host offers the capability only when push support is given and refuses the actions otherwise; actions from another origin or without the nonce run nothing; failures send only a short code; the system prompt appears only when it should; a token needs a device, a project and permission; Android's channel is created first; only the four screen names pass and a URL, a path or a wrong case does not; a tap is collected once; the event script cannot be broken out of.
- `expo prebuild` (generated, then deleted): the iOS push entitlement is present and the Android accent colour is set; `expo export` bundles for iOS and Android; `expo-doctor` 20 of 20.
- **Not tested:** anything on a phone or simulator. The permission prompt, a real token, the channel, a real notification and a real tap have not run. A real token needs the owner's Expo project, and for Android a Firebase project; for a real iPhone, a paid Apple Developer account and an APNs key (design section 10.4). Remote push cannot be tested in Expo Go: it needs a development build (`mobile/eas.json` is in the build-profiles pull request). The Android `POST_NOTIFICATIONS` permission comes from the library's own manifest during the Gradle merge, which was not run here.

**Risks and follow-ups.** The Android small notification icon is the app icon until a white, transparent NASA glyph exists (the current assets are Expo placeholders). The web half must create no prompt before sign-in and must remove the phone at sign-out.

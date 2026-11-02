# NASA mobile app: design (issue #22)

| Field | Value |
|---|---|
| Status | **Draft for review.** No mobile code exists yet. Nothing here is agreed until Jasil and the owner approve this pull request. |
| Owner | Jayasoorya (see [OWNERSHIP.md](OWNERSHIP.md)) |
| Reviewer | Jasil |
| Last updated | 2 November 2026, revised after Jasil's clarification of 16:36 IST (connectivity, push, testing first) |
| Brief | Jasil's Slack brief of 2 Nov 2026 (architecture, security, store acceptance) |

One NASA app for iOS and Android. It is a thin native shell around the hosted NASA web app. The web app, the backend and every business rule stay where they are. NASA is online-only.

```
Expo / React Native shell
  -> react-native-webview
     -> NASA's hosted React web app (Vercel)
        -> existing NASA backend and database
```

BUSBEE is only an architecture reference (a WebView inside a React Native shell). Nothing of its features, GPS behaviour or versions is copied.

## 1. What exists today (verified in the code)

| Topic | Today |
|---|---|
| Sign-in | Two areas, `admin` and `driver`, each with its own login endpoint (`POST /admin/login`, `POST /driver/login`). The server decides the role; the screen a person picks grants nothing. |
| Tokens | Access token (15 min) and refresh token (7 days). `POST /<area>/refresh-token` rotates the refresh token. |
| Browser storage | `adminToken`, `adminRefreshToken`, `driverToken`, `driverRefreshToken` in `localStorage` (`Frontend/src/redux/slice/axiosInstance.js`). One axios interceptor adds the token of the request's own area and refreshes on `401`. |
| Logout | `POST /<area>/logout` revokes the refresh token in Redis. |
| Idle sign-out | Admin 5 h, driver 24 h (`useInactivityLogout`). |
| CORS | One allowed origin (`FRONTEND_URL`). A WebView that loads the hosted site has that same origin, so **no CORS change is needed**. |
| Accounts | Drivers and admins are created by an admin (`POST /admin/create-users`). There is no self sign-up. |
| Phone-relevant workflows | Driver: up to 3 images on the access-code form. Admin: daily and weekly Excel file uploads. |
| Notifications | None exist (no push, no device registry). |
| Safe areas | The viewport already uses `viewport-fit=cover` and the glass tab bar uses `env(safe-area-inset-bottom)`. |

## 2. Principles

1. **The web app owns screens and navigation.** The shell adds no second navigation.
2. **The server owns every rule**: pay, rates, insurance, paid history, Excel, roles, cities and record ownership. The shell has no copy of them.
3. **Reliable on weak connections, with no offline writes.** The app recovers from poor signal, keeps what the person has typed, and may show recently loaded data clearly marked as such (section 6). Offline writes and replay queues are **not** an agreed requirement; if wanted they are scoped separately. (Issue #22's earlier wording about "queue actions" and a PWA is replaced by this design; see section 9.)
4. **Narrow, versioned bridge.** The shell exposes a short list of named actions, nothing generic.
5. **A web release must never require a native feature an older installed shell lacks.**

## 3. Session design

**Problem.** Today a long-lived refresh token sits in `localStorage`. Putting a second copy in secure storage would not fix that.

**Decision.** In the mobile app, the **native shell owns the refresh token** in secure storage (iOS Keychain, Android Keystore, through `expo-secure-store`). The WebView keeps only the short-lived access token, in memory.

How it works, for each of the four moments:

| Moment | Flow |
|---|---|
| **Sign in** | The person signs in on the existing web login screen. On success the web app sends `session.set` (area, access token, refresh token) over the bridge. The shell stores the refresh token in secure storage. The web app keeps the access token in memory and **does not write either token to `localStorage`**. |
| **Access token expires** | The axios interceptor sees `401` and calls `session.refresh` over the bridge instead of calling the refresh endpoint itself. The shell calls `POST /<area>/refresh-token`, stores the rotated refresh token, and returns only the new access token. Concurrent refreshes share one call. |
| **App restart** | The shell reads the refresh token, refreshes, and answers the web app's `session.get` with the new access token before the first screen loads. If refresh fails, the web app shows the normal login screen. |
| **Sign out, expiry or user change** | The web app calls `session.clear`. The shell **deletes the refresh token from secure storage first**, so the session cannot come back at the next start even if the network is down, then (best effort, in the background) refreshes once and calls `POST /<area>/logout` to revoke it on the server. It also clears WebView cookies, cache and `localStorage`, and (when push exists) unregisters this device. A different person signing in on the same phone starts from empty state. If the shell cannot be reached, the web app shows that sign-out could not be confirmed on the phone. |

Rules:
- Tokens never appear in URLs, logs, crash reports or the bridge's error messages.
- The shell only does what the server confirms. A refresh that returns `401` means signed out.
- Admin and driver sessions stay separate, as today (`area` is part of every `session.*` message). The shell holds one refresh token per area.
- The web app detects the shell through the capability handshake (section 4). In a normal browser nothing changes: it keeps using `localStorage` as now.
- Optional, later: Face ID / fingerprint to unlock the stored session on app resume (a real native benefit; needs the owner's approval).

**Backend impact.** None for the session. Existing login, refresh and logout endpoints are reused. Expiry, the 7-day limit and Redis revocation are unchanged.

## 4. Bridge contract (version 1)

The bridge is `window.ReactNativeWebView.postMessage` from web to shell, and `injectJavaScript` replies from shell to web.

**Message from web:**

```json
{ "v": 1, "id": "uuid", "nonce": "<page-load secret>", "action": "session.refresh", "payload": { "area": "driver" } }
```

**Reply from shell:**

```json
{ "v": 1, "id": "uuid", "ok": true, "data": { "accessToken": "..." } }
{ "v": 1, "id": "uuid", "ok": false, "error": "unsupported_action" }
```

**Shell checks before acting** (reject silently with `ok:false` otherwise):
1. The message came from a page whose URL origin is in the allowlist (section 7) **and** carries `nonce`: a random secret the shell generates for each page load and injects into the main frame only (`window.__NASA_BRIDGE_NONCE__`). A frame from another site, which on Android may be able to see the bridge object, cannot read it, so its messages get no answer at all.
2. The JSON parses, `v` is a supported number, `id` is a string of at most 64 characters, `action` is in the table below, and `payload` matches that action's shape and size limits.
3. The `id` is unused (replay protection) and the call is not rate-limited.

**Actions in version 1:**

| Action | Direction | Purpose |
|---|---|---|
| `app.hello` | web to shell | Capability handshake. Reply: `{ shellVersion, bridgeVersions: [1], capabilities: ["session", "pickImages", "pickDocument", "share", "openExternal"], platform }`. The web app only uses a native feature the reply lists. |
| `session.get` | web to shell | Get a fresh access token for an area at startup. |
| `session.set` | web to shell | Hand over tokens after sign-in. |
| `session.refresh` | web to shell | Replace an expired access token. |
| `session.clear` | web to shell | Sign out and wipe local state. |
| `media.pickImages` | web to shell | Camera or photo library, up to N images (N from the form, maximum 3 today). Returns file handles the web app uploads with its existing request. |
| `file.pickDocument` | web to shell | Pick an `.xlsx` for the admin upload. |
| `file.share` | web to shell | Open the share sheet for a file the web app downloaded. |
| `link.openExternal` | web to shell | Open an `https` URL in the system browser. |

Anything else gets `unsupported_action`. There is **no** action that runs native commands, evaluates JavaScript or reads arbitrary files.

**Versioning.** The shell lists the bridge versions it speaks. The web app picks the highest version both support. A web feature that needs a native action checks `capabilities` first and falls back to the browser behaviour if missing (for example an `<input type="file">`). Removing an action requires one full release cycle of old shells.

## 5. Navigation ownership

| Concern | Owner |
|---|---|
| Screens, routes, tab bar, back inside the app, deep-link targets | **Web app** (React Router, `GlassTabBar`) |
| Splash and first load, no-connection and server-unavailable screens, retry, WebView crash recovery | **Shell** |
| Android hardware Back | Shell asks the WebView to go back; if the WebView cannot, the shell exits to the launcher |
| External links, `mailto:`, `tel:` | Shell opens them outside the WebView |
| Safe areas | **Top: shell.** It pads the WebView below the status bar on a NASA purple background, so the web header needs no change and `env(safe-area-inset-top)` is 0 inside the WebView. **Bottom: web app**, through `env(safe-area-inset-bottom)` (the glass tab bar already uses it); the WebView runs to the bottom edge and the shell adds no bottom padding. Each inset is applied once. To be confirmed on real iPhones and Android phones |
| Keyboard | Web app scrolls the focused field into view; the shell resizes the WebView, never pans it |
| Status bar | Shell sets light content over the NASA purple header |

The shell shows no native tab bar, no native header and no native back button.

## 6. Weak connections, caching and uncertain writes

Goal: the app works reliably on weak or intermittent signal. It does **not** queue or replay writes.

**Recovery (shell).**
- The WebView stays mounted when the signal drops, so a half-filled form is never lost. A slim "No connection, retrying" banner appears, and the page's own requests retry when the connection returns.
- The full-screen "No connection" screen is only for a first load that cannot complete (there is no page to keep). Its Try again button reloads.
- The current build replaces the WebView on any load error, which would drop typed input. **Follow-up change:** keep the WebView mounted and show a banner for errors after the first load.

**Keeping what was typed (web).** Forms with several fields (journey, access-code, agreement) keep a draft in memory for the session, keyed by the signed-in user and area, and restore it after a reconnect or a WebView reload. Drafts are removed on sign-out and when a different person signs in. They are never written to shared storage.

**Caching (web), read-only data only.**
| Data | Cache | Shown as |
|---|---|---|
| Driver deliveries list, weekly pay breakdown, availability, route list | Last good response, in memory | Normal, with "Updated 14:05" and a Refresh action when it is older than 2 minutes or the last refresh failed |
| Admin lists (cities, routes, users) | Same | Same |
| Admin dashboard and payment tables, anything that decides who is paid | **Not cached for display after a failed refresh**: an error is shown instead of old numbers | n/a |

Rules: the cache key includes the user id and area; it is cleared at sign-out and on user change; the server remains the only authority and a stale screen never enables a write that a fresh one would not. Which screens may show stale data is a **decision for Jasil**; the table is the proposal.

**Writes.**
- Success is shown only after the server confirms it.
- **Uncertain write** (the connection drops after the request was sent): the page shows "We could not confirm this was saved", disables the submit button, re-reads the record, and only lets the person submit again if it is not there.
- Writes that can be repeated by mistake today are `POST /driver/journey`, `POST /driver/access-codes`, `POST /driver/agreement` and the two Excel uploads. A backend pull request should accept an `Idempotency-Key` header on these (kept for a short time, so a repeat returns the first result). The Excel uploads already run one at a time.

## 7. Environments and security

| Item | Rule |
|---|---|
| Origins | Per build profile: `development`, `preview` (staging) and `production`, each with one HTTPS web origin and one HTTPS API origin from build configuration. Release builds contain no development address and no TLS bypass. |
| Allowlist | The WebView loads only the configured web origin. Navigation to any other origin is cancelled and, for `https`, opened in the system browser. Redirects are checked the same way. |
| Secrets | None in the app. Signing keys and store credentials stay outside the repository (EAS secrets, owner-controlled). |
| Logging | No tokens, request bodies or personal data in logs, in debug or in release builds. |
| Permissions | Only what a shipped feature needs: camera and photo library for `media.pickImages`; notifications only if push ships. **No location, no background modes.** |
| Role access | Unchanged: the backend checks role, city and record ownership on every request (`requireRole`, `requireSelf`, city limits). Hiding a button is never the control. |

## 8. Native MVP (proposal, for decision)

Apple's guideline 4.2 expects a real app, not a repackaged website. A WebView alone is a starting point, not a guarantee. The proposal is to pick features that help real NASA workflows:

| # | Feature | Real NASA need | Cost | Recommendation |
|---|---|---|---|---|
| 1 | Shell, session handoff, error and offline screens, Android Back, external links | Required for everything | Medium | **In MVP** |
| 2 | Camera or photo picker for the access-code images | Drivers photograph gate or mailbox access details | Low | **In MVP** |
| 3 | Document picker for the admin Excel upload | Admins upload daily and weekly files from a phone | Low | **In MVP** |
| 4 | Share sheet for downloaded files | Send a pay breakdown or export | Low | In MVP if an export exists; ask |
| 5 | Biometric unlock of the stored session | Drivers reopen the app often | Low | **Undecided.** See the explanation below. Not a blocker for testing |
| 6 | Push notifications | Reminders and updates on existing NASA workflows | High | **Approved by Jasil.** Design in section 10 |
| 7 | Deep links from notifications | Open the right screen from a tap | Medium | Part of 6 |

Features 2 and 3 already work as plain `<input type="file">` in a WebView. The bridge versions give a better experience (camera choice, native picker) and are the fallback target for browsers. Push (item 6) is the strongest answer to Apple's guideline 4.2.

**What biometric unlock means.** After a person has signed in, the app keeps the session in secure storage. Today the app opens straight into that session. With biometric unlock, the app would ask for Face ID, Touch ID or a fingerprint each time it is reopened after being in the background for a while, before showing any NASA data. The login password is not replaced, and the session is not stored any differently. It protects a lost or borrowed unlocked phone. It adds a step for drivers, needs a fallback to the phone passcode, and adds an iOS permission string. It is optional and off by default if we build it.

## 9. Store readiness (separate checklist, tracked on issue #22)

- **Accounts.** Accounts are created by admins, not in the app. Apple's in-app account deletion rule applies when an app supports account creation; NASA does not, but the assessment goes in the review notes. Google Play asks for a deletion path where users sign in; plan an in-app "Request account deletion" screen plus a public web page. Business records (deliveries, payments, paid history) are **kept** for accounting; the request removes sign-in access and personal contact details, and an admin completes it.
- **Ownership.** Who owns the developer accounts, final bundle and package IDs, signing keys and store access is **to be discussed later**; this design does not choose it. Until then the IDs are placeholders and nothing is published. Dependencies that genuinely block a test are listed in section 10.4.
- **Review material.** Reviewer accounts (one driver, one city admin, one super admin) with synthetic data, privacy policy URL, support URL, Data safety and privacy labels, content rating, screenshots from real devices. Credentials go in the store review fields only.
- **Builds.** EAS profiles `development`, `preview`, `production`; TestFlight and Google Play internal testing before production. Use the Expo SDK, React Native and `react-native-webview` versions that are current and compatible at the time (checked then, not copied from BUSBEE). Confirm the current Apple SDK and Android target API requirements when the accounts are opened.

**Issue #22 correction.** The issue still describes a PWA that queues actions on weak signal. That conflicts with this design (store app, online-only). On approval, update the issue text; the "done when" list (driver sign in, journey, availability, deliveries, weekly pay; admin screens) stays.

## 10. Push notifications (design, approved to proceed)

**10.1 Rules.**
- The server decides who gets what. Targeting comes from the database (role, city, the driver's own id), never from the client.
- A device is registered only by a signed-in person, with identity from the token, and is removed at sign-out, on user change and when the push service reports it invalid.
- Lock-screen text is generic: no names, amounts, route names or city names. Detail is shown inside the app after sign-in.
- A tap opens a route from a fixed allowlist. The web app's own sign-in and role checks then decide what is shown, so a tap can never reach a screen the person may not see.
- If permission is denied, nothing breaks. The app asks in context after the first sign-in (with a short reason), and offers a link to settings later.

**10.2 Backend.**
- Table `device_tokens` (user type, user id, push token, platform, app version, created, last seen, revoked). One token belongs to one user at a time. Registration endpoints for drivers and admins, and removal at logout.
- A small sender service that batches messages to Expo's push API (at most 100 per request), has a timeout, reads receipts, and deletes tokens marked `DeviceNotRegistered`. It runs after the database commit and never delays or fails the request that triggered it.
- Migration, rollback and indexes follow the database standard in `ENGINEERING_STANDARD.md`.

**10.3 Initial events (proposal, from workflows that already exist).**
| Event | Who | Lock-screen text | Taps to |
|---|---|---|---|
| Weekly availability reset (the existing Sunday noon job) | Each driver, in their own time zone | "Time to set your availability for next week." | Availability |
| A driver is marked paid | That driver | "You have a pay update." | Deliveries |
| An agreement needs signing or was updated | Affected drivers | "Please review your agreement." | Agreement |
| A driver submits an access code | Admins assigned to that driver's city, and super admins | "A new access code was submitted." | Access codes |

Each event can later get an on/off switch per person. Nothing is sent for the Excel upload or pay calculation.

**10.4 Credentials boundary.**
| Test | Needs | Account needed |
|---|---|---|
| Register a token, send, show on lock screen and tap routing on an **iOS simulator** | A test payload only, no Apple credentials | None |
| Same on an **Android device** or emulator with Google Play services | An FCM v1 service account key uploaded to Expo | A Google (Firebase) project |
| Same on a **real iPhone** | An APNs key and the device registered | A paid Apple Developer account |
| App Store or Play publishing | Final identifiers and signing | Decided later |

A full iOS push test on a real phone can wait until just before deployment. Remote push cannot be tested in Expo Go, so a development build (EAS) is needed.

## 11. Testing before deployment

Testing on simulators and real devices comes before any release. Unit tests and bundling are useful, but they do not replace it.

| Area (from Jasil's list) | How it will be checked | Status |
|---|---|---|
| Bridge rules, session store, protocol | Unit tests with fakes (`mobile/`, 33) | **Done** |
| Web session adapter against the real backend | Chrome, fake shell | **Done** (driver; admin shares the code) |
| App starts, loads the web app in a real WebView | iOS simulator, Android emulator, a phone | **Not done** |
| Sign-in, restore after restart, expiry, refresh, logout, user change | Same, with the three roles | **Not done** |
| Role and city isolation | Server checks, tested from the app as each role | **Not done** |
| Keyboard, small screens, safe areas, text scaling, Reduce Motion | Real devices | **Not done** |
| Android Back, background and resume, WebView crash recovery | Android device | **Not done** |
| Interrupted requests and weak signal, no duplicate submissions | Network throttling on device | **Not done** |
| Cross-origin frame cannot use the bridge on Android | Android device with a test page | **Not done** |
| Push: permission, registration, targeting, tap routing, logout cleanup | Dev build, section 10.4 | **Not started** |

**Reproducible test builds** (once the shell is verified to start):
1. `eas build --profile development --platform ios` with the simulator setting, and `--platform android` for an installable `.apk`. Both need only a free Expo account.
2. A backend and website reachable from the phone (a deployed preview or the Mac's address on the same network, with `FRONTEND_URL` and the website's API address set to match).
3. Synthetic accounts for a driver, a city admin and a super admin.

Tools needed on the build Mac: **Xcode** for the iOS simulator and **Android Studio** (SDK and emulator) for Android. They are not installed on the current development Mac. A physical phone with a development build avoids that.

## 12. Delivery plan (small pull requests into `develop`)

Testing on real simulators and devices comes before deployment, so it leads the plan.

1. **Done, in review:** this document (#123), web bridge client (#124), web session adapter (#125), Expo project and protocol (#126), WebView shell (#127).
2. **First run on devices** (blocked until Xcode or Android Studio is on a Mac, or a phone is used): start the shell, fix what the real WebView shows, and record the results in the table in section 11.
3. **`eas.json` build profiles** (development, preview, production) so test builds are reproducible.
4. **Connection recovery:** keep the WebView mounted with an offline banner, draft restore, and cached read-only data with a freshness label (section 6).
5. **Backend: `Idempotency-Key`** on the repeatable writes.
6. **Push, backend:** `device_tokens` migration, registration and removal endpoints, the sender service, the four events in section 10.3.
7. **Push, app and web:** permission prompt, registration, tap routing, logout cleanup. End-to-end tests per section 10.4.
8. **Phone features** chosen in section 8, one pull request each.
9. **Store checklist and submission material,** after ownership is decided.

Acceptance checks follow Jasil's list: role and city isolation checked on the server, session expiry, refresh, logout, restart and user change, same totals before and after, real-device keyboard, safe areas, Back and text scaling, permission denial and cancelled pickers, no connection and interrupted writes without duplicates.

## 13. Not tested, decisions

The shell has not run on a phone (section 11). Open decisions: biometric unlock (explained in section 8, undecided), which screens may show stale data (section 6), developer-account ownership (later), and approval of the `Idempotency-Key` backend change.

# NASA mobile app: design (issue #22)

| Field | Value |
|---|---|
| Status | **Draft for review.** No mobile code exists yet. Nothing here is agreed until Jasil and the owner approve this pull request. |
| Owner | Jayasoorya (see [OWNERSHIP.md](OWNERSHIP.md)) |
| Reviewer | Jasil |
| Last updated | 2 November 2026 |
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
3. **Online-only.** No offline writes, no queue, no replay. (Issue #22's earlier wording about "queue actions" and a PWA is replaced by this design; see section 9.)
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

## 6. Connection behaviour and uncertain writes

- Online-only: no cached operational data is shown as current and no write is stored for later.
- **Offline or server down:** the shell shows a full-screen state with a Retry button. The web app's own error toasts still handle failed requests.
- **Success is shown only after the server confirms it.**
- **Uncertain write** (the connection drops after the request was sent): the web app shows "We could not confirm this was saved", disables the submit button, **re-reads the record** from the server, and only then lets the person submit again if it is not there.
- Writes that can be repeated by mistake today are `POST /driver/journey`, `POST /driver/access-codes`, `POST /driver/agreement` and the two Excel uploads. A follow-up backend pull request should accept an `Idempotency-Key` header on these (stored for a short time, so a repeat returns the first result). Until then the re-read rule above applies. The Excel uploads already run one at a time.

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
| 5 | Biometric unlock of the stored session | Drivers reopen the app often | Low | Recommended |
| 6 | Push notifications (for example availability reminders, new agreement) | Needs a new backend: device registry, sender, opt-out | High | **Decision needed**; separate design |
| 7 | Deep links from notifications | Depends on 6 | Medium | After 6 |

Features 2 and 3 already work as plain `<input type="file">` in a WebView. The bridge versions give a better experience (camera choice, native picker) and are the fallback target for browsers. **Open question for Jasil and the client:** is push worth building before the first store submission? Items 5 and 6 are the strongest answer to guideline 4.2.

## 9. Store readiness (separate checklist, tracked on issue #22)

- **Accounts.** Accounts are created by admins, not in the app. Apple's in-app account deletion rule applies when an app supports account creation; NASA does not, but the assessment goes in the review notes. Google Play asks for a deletion path where users sign in; plan an in-app "Request account deletion" screen plus a public web page. Business records (deliveries, payments, paid history) are **kept** for accounting; the request removes sign-in access and personal contact details, and an admin completes it.
- **Ownership.** The developer accounts, bundle and package IDs, signing keys and store access must belong to the client, agreed before the first build. **Needs the owner.**
- **Review material.** Reviewer accounts (one driver, one city admin, one super admin) with synthetic data, privacy policy URL, support URL, Data safety and privacy labels, content rating, screenshots from real devices. Credentials go in the store review fields only.
- **Builds.** EAS profiles `development`, `preview`, `production`; TestFlight and Google Play internal testing before production. Use the Expo SDK, React Native and `react-native-webview` versions that are current and compatible at the time (checked then, not copied from BUSBEE). Confirm the current Apple SDK and Android target API requirements when the accounts are opened.

**Issue #22 correction.** The issue still describes a PWA that queues actions on weak signal. That conflicts with this design (store app, online-only). On approval, update the issue text; the "done when" list (driver sign in, journey, availability, deliveries, weekly pay; admin screens) stays.

## 10. Delivery plan (small pull requests into `develop`)

1. **This document.** Review and approve.
2. **Web: bridge client and capability detection.** Detects the shell, otherwise does nothing. No behaviour change in a browser.
3. **Web: session adapter.** The axios interceptor uses `session.refresh` in the shell; tokens stay in memory there. Tested in a browser with a fake bridge.
4. **Backend (if approved): `Idempotency-Key`** on the repeatable writes.
5. **Shell repo or folder (`mobile/`):** Expo app, WebView container, allowlist, bridge host, session storage, offline screen, Android Back. Reviewable builds on a real iPhone and Android phone.
6. **Native features** chosen in section 8, one pull request each.
7. **Store checklist and submission material.**

Acceptance checks follow Jasil's list: role and city isolation checked on the server, session expiry, refresh, logout, restart and user change, same totals before and after, real-device keyboard, safe areas, Back and text scaling, permission denial and cancelled pickers, no connection and interrupted writes without duplicates.

## 11. Not tested

This is a design. Nothing was run on a phone. Decisions that need an answer: the push question (section 8), who owns the developer accounts and bundle IDs, whether biometric unlock is wanted, and approval of the `Idempotency-Key` backend change.

# NASA mobile app: store readiness checklist (issue #22)

| Field | Value |
|---|---|
| Status | **Draft, 2 November 2026.** Nothing has been submitted. No developer account, bundle ID or signing key exists yet. |
| Owner | Jasil (see [OWNERSHIP.md](OWNERSHIP.md)) |
| Related | [MOBILE_APP_DESIGN.md](MOBILE_APP_DESIGN.md) (sections 7 to 13) |

Legend: **Done** is built and covered by tests or by a generated-project check. **Needs a device** is built but never run on a phone. **Needs the owner** waits on an account, an identifier or a decision. **Not started**.

## 1. Decisions and accounts (all "Needs the owner")

| Item | Why it blocks | Proposed |
|---|---|---|
| Who owns the Apple Developer and Google Play accounts | Bundle and package IDs, signing and store access follow from it; Apple review needs a paid account | The client, as Jayasoorya suggested; to be discussed |
| Final bundle ID and Android package (today `com.example.nasalogistics`, a placeholder) | Cannot be changed after the first store release | One reverse-domain ID chosen with the owner |
| Expo account and project ID (`eas init`), set as `EAS_PROJECT_ID` | EAS builds and any real push token | The owner's account |
| Firebase project and `google-services.json` for Android push | Android push cannot be tested without it | Free, in the owner's Google account |
| APNs key (a paid Apple account) | A real iPhone push test | After ownership is decided |
| Account deletion: who may request it, how long records are kept, what stays on paid history | Both stores ask whether people can create accounts in the app; admins create driver and admin accounts inside the app | Assessment is in the design, section 9; keep deliveries, payments and paid history, remove sign-in access and contact details |
| Which screens may show old data on a weak connection | Needed before the read-only cache | The proposal in design section 6 |

## 2. What the build ships (verified in the generated native projects, 2 Nov)

| Item | State |
|---|---|
| Permissions: iOS camera reason text only; Android declares none of its own (`INTERNET` and `VIBRATE` come from the platform and notifications); storage and overlay permissions blocked | Done |
| No Face ID or biometric text, no location, no microphone, no background modes | Done |
| Page access to the camera and microphone denied on iOS; cannot be granted on Android because the app holds no such permission | Done (test keeps it in place) |
| Cleartext http only in development builds; preview and production refuse it | Done |
| Development client's local-network entries removed from preview and production | Done |
| Origins and secrets from build settings only; no signing material in the repository | Done |
| App name, version, orientation, light interface | Done; icons and splash are **Expo placeholders** (needs the client's artwork) |
| Android notification small icon (white, transparent) | Not started (needs artwork) |
| `ITSAppUsesNonExemptEncryption` (export compliance answer) | Not started: the app uses only standard HTTPS, but this is a legal declaration for the owner to confirm |

## 3. Apple App Store

| Item | State |
|---|---|
| More than a repackaged website (guideline 4.2): push notifications on real workflows, native session security, connection recovery, system file pickers | Built; push and the shell **need a device** |
| Working reviewer accounts for each role (driver, city admin, super admin) with synthetic data, entered privately in the review fields | Not started |
| An accessible backend for the reviewer (a staging or production API the reviewers can reach) | Needs the owner |
| Privacy policy URL, support URL | Not started (needs the owner's text and hosting) |
| App privacy answers (data collected: name, email, delivery and pay records, photos the driver chooses, push token; none sold; none for tracking) | Not started |
| Account deletion in the app, if the assessment says it applies (guideline 5.1.1(v)) | Not started; decision above |
| Screenshots from real devices, review notes | Not started (needs a device) |
| TestFlight build before production | Needs the owner (paid account) |
| Current Apple SDK requirement when submitting | Check at submission time |

## 4. Google Play

| Item | State |
|---|---|
| Not an unauthorized website wrapper: published under the owner's identity, with real native functionality | Needs the owner |
| App access instructions for the restricted roles; reviewer credentials in the Play Console fields only | Not started |
| Privacy policy URL | Not started |
| Data safety form (same data as the Apple answers, plus the camera used through the system picker) | Not started |
| Content rating, target audience | Not started |
| Account deletion: the in-app route and a public web page, if applicable | Not started; decision above |
| Permission declarations | None needed beyond the platform defaults |
| Internal testing track, then closed testing if the account type requires it | Needs the owner |
| Current target API level requirement when submitting | Check at submission time |

## 5. Testing before deployment (design section 11)

Nothing below has run on a phone or simulator. This Mac has no Xcode and the Android emulator image here is incomplete, so a physical phone (with a development build) or a repaired emulator is the realistic route.

| Check | State |
|---|---|
| App starts and loads the web app in the real WebView; sign-in, restore after restart, expiry, refresh, logout, user change; role and city isolation as each role | Needs a device |
| Keyboard, safe areas, text scaling, Reduce Motion, Android Back, background and resume, WebView crash recovery | Needs a device |
| The nonce keeps a cross-origin frame out on Android | Needs a device |
| Interrupted requests: the journey form's saved, not saved and could-not-confirm paths | Built (simulated drops in tests); **needs a device** with a real weak connection |
| File pickers: the camera choice, a photo, an Excel file through the system pickers; blocking the Android storage permissions does not break the chooser on older Android | Needs a device |
| Push: permission prompt, denied state, lock-screen text, tap routing (presentation) | Needs a development build on a device |
| Push, the real path: registration, targeting, delivery through Expo, receipts, removal at sign-out | Needs the owner's Expo, Firebase and (iPhone) Apple accounts |
| Role and city checks, same totals before and after, paid history unchanged | Server rules are unchanged and covered elsewhere; **needs a run through the app** |

## 6. Not built, on purpose

- Biometric unlock (decision of 2 Nov).
- Offline writes and replay queues (not an agreed requirement).
- A share sheet and bridge-based pickers (the web app has no export; the system pickers already work in the WebView).
- Drafts and the unconfirmed-save check for the access-code and agreement forms, and the read-only cache with a freshness label.
- A "notifications are off, open settings" screen (the shell action exists).

# Mobile app design: session, bridge, navigation and native MVP (issue #22)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #22 / see the pull request for this branch
- **Branch:** `docs/mobile-app-design` (from `develop`)
- **Type and scope:** docs
- **Files touched:** `docs/MOBILE_APP_DESIGN.md` (new). No code, no reserved files.

**What and why.** Jasil's brief of 2 Nov 2026 asks for one NASA app for iOS and Android, built as an Expo / React Native shell around the hosted web app, and says to document the session design, bridge contract, navigation ownership and native MVP before any code. This document does that, based on how sign-in works today (tokens in `localStorage`, 15 minute access and 7 day refresh tokens, per-area sign-in, Redis revocation at logout).

Main decisions proposed, all for review:
- The native shell owns the refresh token in secure storage; the web app keeps only a short-lived access token in memory when running inside the shell.
- A small, versioned bridge with nine named actions and a capability handshake, so older installed apps keep working when the web app changes.
- The web app owns all navigation and safe areas; the shell owns only loading, offline and error screens, Android Back and external links.
- Online-only with a "re-read before retry" rule for uncertain writes, and a follow-up backend `Idempotency-Key` proposal.
- A native MVP that favours real workflows (camera for access-code images, document picker for Excel upload, biometric unlock), with push notifications left as a decision.

**Issue #22 conflict.** The issue text still describes a PWA that queues actions on weak signal. That conflicts with the new online-only store-app direction. The document says so; the issue should be updated once this is approved.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** Facts in section 1 were checked against the code (`axiosInstance.js`, `useInactivityLogout.js`, `jwtservice.js`, `driverRoutes.js`, `adminRoutes.js`, `redis-jwt-service.js`, `index.html`). Not tested: nothing was run on a phone; the design is untried.

**Risks and follow-ups.** Open decisions: push notifications, who owns the developer accounts and bundle IDs, biometric unlock, the `Idempotency-Key` backend change. Next pull request after approval: the web bridge client with capability detection.

## Revision after Jasil's clarification (2 Nov, 16:36 IST)

- **Testing first.** New section 11 lists every check Jasil named with its real status. Only the unit tests and the web-side session checks are done; nothing has run in a real WebView, simulator or phone. The delivery plan now starts with first runs on devices.
- **Connectivity.** "Strictly online-only" is replaced by "reliable on weak connections, no offline writes". Section 6 proposes recovery (keep the WebView mounted, offline banner), draft restore, and read-only caching with a freshness label, keyed by user and cleared at sign-out. Money screens do not show old numbers after a failed refresh. Which screens may be stale is left to Jasil. Offline writes and replay queues are out of scope until agreed.
- **Push notifications** (approved to proceed). Section 10: server-side targeting, `device_tokens` table, registration and removal, generic lock-screen text, tap routing through an allowlist, four initial events taken from existing workflows (weekly availability reset, driver marked paid, agreement needs signing, access code submitted to the city's admins), and the credentials boundary (iOS simulator needs none; Android needs an FCM key; a real iPhone needs a paid Apple account; remote push needs a development build, not Expo Go).
- **Ownership** of developer accounts and final IDs is left open on purpose.
- **Biometric unlock** is explained in section 8 and stays undecided.

Nothing in code changed in this revision. The current shell still replaces the WebView on a load error; the follow-up change is listed in section 6.

## Biometric decision (2 Nov, later)

Jasil confirmed that Face ID / fingerprint session unlock is **out of the initial release**: optional for NASA's workflows and extra implementation, device testing and maintenance. The design now says so (section 8). Session security is unchanged: normal sign-in, refresh token in the phone's secure storage, refresh, expiry and logout, and backend RBAC. No biometric prompt or permission string is added. Nothing in code needed to change, because biometrics were never built.

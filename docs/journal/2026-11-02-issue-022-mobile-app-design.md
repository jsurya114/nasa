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

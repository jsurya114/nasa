# Push notifications, step 2: the sender and the four events

| Field | Value |
|---|---|
| Date | 2026-11-02 |
| Author | Jasil (with Claude Code) |
| Issue / PR | `#22` / see the pull request for this branch |
| Branch | `feat/push-sender-events` (built on `feat/push-device-tokens`; merge that pull request first) |
| Type / scope | `feat(backend)` |
| Files touched | New: `Backend/services/push/expoPushClient.js`, `pushSender.js`, `pushTargets.js`, `pushEvents.js`, `Backend/tests/pushSender.test.js`. Edited: `Backend/locales/backend/en.js` and `es.js` (a `push` section), `Backend/.env.example`, and one import and one call each in `controllers/admin/dashboardController.js`, `controllers/admin/agreementController.js`, `controllers/driver/accessCodeControllers.js`, `utils/availabilityCronJob.js` (also exports `resetDriversInTimezone` so it can be tested) |
| Reserved files touched | `dashboardController.js` is in the Excel, pay and dashboard zone (Jasil's, so mine). The other three are Jayasoorya's zone; each change is one import and one line after the work has succeeded. |

**What and why.** Sections 10.1 to 10.3 of `docs/MOBILE_APP_DESIGN.md`: the server can now send the four approved notifications. It is **off** until `PUSH_NOTIFICATIONS_ENABLED=true`.
- **Who gets what is decided by the server, from the database.** Drivers' phones come from `device_tokens` joined to `drivers` (a switched-off driver gets nothing). Access-code admins are the active admins assigned to the driver's city (`admin_city_ref`) plus active super admins; a different city's admin, a deactivated admin and a revoked phone get nothing.
- **The four events.** Availability reset (after the existing Sunday noon job resets a time zone, so each driver is told at their own noon); a driver marked paid (`payDriver`, the only place `paid = true` is written, and only when rows were actually updated); an agreement revoked (the admin toggle with `status === false` only); a driver submits an access code (only after it is saved, so a duplicate or a failed save sends nothing).
- **Lock-screen text is generic and in the driver's language** (`preferred_language`, English or Spanish; admins get English). No names, amounts, routes, cities or access codes. The message carries a `screen` name (`availability`, `deliveries`, `agreement`, `access-codes`), never a URL; the app maps it to one of its own screens.
- **Never in the way of a request.** Each event returns at once and does its work on the next turn of the event loop. Every failure (database, network, Expo) is caught and logged and goes no further. Expo calls have a 10 second timeout and go out in groups of at most 100.
- **Dead phones are removed.** A `DeviceNotRegistered` ticket deletes that token straight away. Receipts are read 15 minutes later (Expo's guidance) and delete phones reported gone. The receipt check is a timer in memory, so a restart inside those 15 minutes skips it; a dead token is then removed the next time a send to it fails. Plain failures (timeout, service down) keep tokens.
- Logs carry counts only, never a token or message text.
- New settings in `Backend/.env.example`: `PUSH_NOTIFICATIONS_ENABLED`, `EXPO_ACCESS_TOKEN` (only with Expo's enhanced security), `EXPO_PUSH_API_URL` (tests and staging; defaults to Expo).

**Database.** None in this pull request (uses `device_tokens` from the previous one).

**Config and dependencies.** The three environment variables above. No new packages (Node's built-in `fetch`).

**Money impact.** None. The paid event runs after the update and does not touch it. Pay, rates and paid history are unchanged.

**Tested.**
- `npm test`: 13 tests run everywhere (Expo client with a fake `fetch`: batching of 250 into 100, 100 and 50, ticket order, error codes, a 500, a socket error, a timeout and bad JSON never throw, the access-token header; the sender with a fake database: off by default, generic messages, deletion of gone phones, the 15 minute receipt check, a failure never reaches the caller).
- With `PUSH_TEST_DB=1` against a throwaway local PostgreSQL (rebuilt schema, not production), 17 more, 30 of 30 in all: targeting (disabled driver, revoked phone, other city, deactivated admin, super admin), each of the four events against a fake Expo server (right phones, Spanish text, a screen name, no name in the message), events return at once and send nothing when switched off, a gone phone is deleted and others kept, a push service that is down leaves tokens alone, and the real Sunday reset function notifies only the drivers it reset.
- Mutation checks: removing the revoked, disabled-driver, deactivated-admin or city condition each makes tests fail.
- End to end over HTTP against the real app, real PostgreSQL and Redis, and a fake Expo server: phones registered through the real endpoints; an admin revoking an agreement sends the Spanish agreement message to that driver; an admin of another city is refused (403) and nothing is sent; marking an agreement as signed sends nothing; a driver's access code reaches the city's admin only, with no name, address or code in the text; a duplicate code (409) sends nothing; marking paid sends the pay message, and a second click with nothing left to pay sends nothing; after the phone is removed nothing is sent; no push token appears in the server log.
- **Not tested:** the real Expo service, APNs or FCM, and any phone (no Expo project, no credentials, no app registering yet). Delivery, receipts from the real service and the tap are therefore untested. Production schema (issue #21) not used.

**Risks and follow-ups.** Keep `PUSH_NOTIFICATIONS_ENABLED` off in production until the app side ships and a real Android test has passed. The app (next pull request) must register the phone, create the Android notification channel named `default` (the messages name it), and map `screen` to its fixed list. Notification on/off switches per person, and a durable queue for receipts, are possible later; neither is needed for the first release.

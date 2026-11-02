# Push notifications, step 1: device tokens and registration endpoints

| Field | Value |
|---|---|
| Date | 2026-11-02 |
| Author | Jasil (with Claude Code) |
| Issue / PR | `#22` / see the pull request for this branch |
| Branch | `feat/push-device-tokens` |
| Type / scope | `feat(backend)` |
| Files touched | `Backend/migrations/2026-11-02-issue-022-device-tokens.sql` and `.rollback.sql` (new), `Backend/services/push/pushTokenRules.js`, `Backend/services/push/deviceTokenQueries.js`, `Backend/controllers/pushTokenController.js`, `Backend/tests/pushTokens.test.js` (all new), `Backend/routes/driverRoutes.js` and `adminRoutes.js` (two route lines and one import each), `Backend/package.json` (test script), `.github/workflows/ci.yml` (test step) |
| Reserved files touched | None of the Excel and pay zone. `driverRoutes.js`, `adminRoutes.js` and `ci.yml` are Jayasoorya's zone; the change is additive and was agreed as part of the mobile handover (push is in the design, section 10, approved by Jasil). |

**What and why.** Section 10.2 of `docs/MOBILE_APP_DESIGN.md`: before the server can send a push message it has to know which phones belong to whom. This pull request adds only that, and sends nothing.
- Table `device_tokens`: one row per Expo push token (`user_type` driver or admin, `user_id`, platform, app version, created, last seen, `revoked_at`). The token is unique, so it belongs to one person at a time. When a different person signs in on the same phone and registers it, the row moves to them and any earlier owner stops receiving it.
- `POST /driver/push-token` and `POST /admin/push-token` register a phone; `POST /driver/push-token/remove` and `POST /admin/push-token/remove` switch it off. The person comes from the verified sign-in token, never from the body or the URL (a test sends other ids in the body and checks they are ignored). A removal only affects a token that belongs to the caller; a token that is not theirs answers the same as one already off, so nothing is revealed about other people. Removal is a POST rather than a DELETE with a body because some proxies drop DELETE bodies.
- Input is checked: the token must look like an Expo push token (bounded length and characters), the platform is `ios` or `android`, the app version is a short string.
- At most 5 active phones per person; registering a sixth switches off the least recently seen. This stops a runaway client growing the table.
- The token is never logged. The log line has the user type, id and platform only.
- `npm test` now runs `node --test`; the backend CI job runs it (it was a placeholder before).

**Database.** New table and one partial index; no existing table or column changes. Migration `Backend/migrations/2026-11-02-issue-022-device-tokens.sql`, rollback `...device-tokens.rollback.sql` (drops the table; it holds only push tokens, which phones register again at the next start). Safe to run more than once. Back up and run on a copy first.

**Config and dependencies.** None.

**Money impact.** None.

**Tested.**
- 3 pure tests (token shape, registration and removal rules) run in CI. 7 database tests are skipped unless `PUSH_TEST_DB=1`; I ran them against a throwaway local PostgreSQL (a rebuilt schema, not production): 10 of 10 pass. They apply the real migration file twice (rerunnable), then check: registering twice keeps one row, a phone moves to the next person, the limit of 5 switches off the oldest, a person can switch off only their own phone, a removed phone comes back on re-registration, the controllers refuse bad input and ignore ids in the body.
- Mutation check: with the owner condition removed from the removal query, 2 of those tests fail.
- End to end over HTTP against the real app with a real local Redis: no token 401; an admin token on a driver route 403 and the reverse; a bad token 400; a valid registration 200 with the row stored; a driver removing an admin's token answers 200 and changes nothing; removing their own switches it off; the token string does not appear in the server log.
- Not tested: against production data or the real schema (the trigger and table sources are still missing, issue #21; this table does not touch them). Nothing was sent to a phone.

**Risks and follow-ups.** The sender and the four events come in the next pull request, and the app side after that. Until the app registers phones the table stays empty. Logout does not remove tokens by itself: the app removes its own token before signing out (app pull request). If that call fails the token stays registered to that person until the same phone is used by someone else or the push service reports it invalid.

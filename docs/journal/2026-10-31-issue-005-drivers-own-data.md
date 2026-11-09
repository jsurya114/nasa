# Drivers only see and change their own data

Legacy ID: J-005 (written before this folder existed; the ID is no longer used).

| Field | Value |
|---|---|
| Date | 31 October 2026 |
| Author | Jayasoorya Suryadas, with Claude Code |
| Branch / PR | `fix/driver-own-data` / pull request into `develop` (issue #5) |
| Type / scope | `fix(drivers)` |
| Files touched | `Backend/middlewares/requireSelf.js` (new), `Backend/routes/driverRoutes.js` |
| Reserved files touched | None |

**What and why.** Five driver endpoints took the driver ID from the URL or the request body. They now compare it with the ID in the verified token and answer `403 FORBIDDEN` when it belongs to someone else. A new shared `requireSelf(field, source)` middleware does the check. The URLs and body shapes are unchanged, so the driver app and the frontend keep working.

**Endpoints covered.**
- `GET /driver/deliveries/:driverId`
- `GET /driver/journey/:driver_id`
- `POST /driver/journey` (body `driver_id`)
- `GET /driver/language/:driverId`
- `PUT /driver/language` (body `driverId`)

**Behaviour details.** An ID that is not a plain whole number (text, decimals, arrays, objects) is refused. If the field is not sent at all, the request passes on and the controller's own validation answers, so nothing is read or written for another driver. Other driver routes already used the token's ID and were not changed.

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None. The delivery summary query and the pay code were not changed, and no Excel, pay or dashboard file was touched.

**Tested.** A throwaway script (not committed) ran the real `driverRoutes` router and the real `driverAuth` against a local Redis, with only the database call stubbed so every query could be recorded. 18 checks all passed: own ID works on all five endpoints, another driver's ID gets 403 and no query runs for that ID, odd input (`7abc`, `7.5`, array, object) gets 403, and a missing field reaches the controller's own 400. The same script failed 10 of 18 on the code before this change. Not tested: a real database, and the frontend in a browser.

**Risks and follow-ups.** The frontend sends the signed-in driver's own ID everywhere these endpoints are used, so nothing should change for drivers. Please check the delivery page, today's journey, saving a journey and the language switch once on this branch. Issue #4 (pull request in review) is independent: this change does not need it.

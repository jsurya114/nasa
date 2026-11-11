# Driver profile: a driver edits their own full name, email and phone

| Field | Value |
|---|---|
| Date | 2026-11-11 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `feat/driver-profile-edit` |
| Type / scope | `feat(drivers)` |
| Files touched | Backend: `controllers/driver/profileController.js` (new), `services/driver/profileRules.js` (new), `services/driver/profileQueries.js` (new), `routes/driverRoutes.js`, `controllers/driver/driverController.js`, `services/driver/loginQueries.js`, `locales/backend/en.js` and `es.js`, two new test files. Frontend: `components/Drivers/Profile.jsx` (new), `redux/slice/driver/profileSlice.js` (new), `redux/store.js`, `App.jsx`, `reuse/driver/Nav.jsx`, `reuse/driver/Header.jsx`, `hooks/translation.js`, `locales/backend/en.js` and `es.js`, one new test file |
| Reserved files touched | None. Read only: `weeklyExcelQueries` (see the risk below) |

**What and why.** A signed-in driver has a new **Profile** page (`/driver/profile`, under **More** in the bottom bar, and the name in the header opens it). It shows their full name, email and phone number, and an Edit button turns them into a form with Save and Cancel. Before this, only an admin could change these. English and Spanish both.

- `GET /driver/profile` and `PUT /driver/profile`, driver tokens only (an admin token gets 403, no token gets 401). The driver is the one in the verified token: an id in the body or the URL is ignored, so a driver can only ever change their own row. The body holds only `name`, `email`, `phoneNumber`; nothing else on the driver (city, code, type, password, enabled) can be reached.
- The rules are the admin form's rules, reused rather than copied: the name is cleaned (extra spaces, at most 100 characters) and unique ignoring case and spaces (`parseDriverName`, `findDriverByName`, #177); the phone is required and must be a 10-digit US number (`parsePhone`); the email must look like an email, at most 150 characters, and no other driver may have it ignoring capital letters. A refusal names the field and is in the driver's language (`X-Language`). The row is locked while it is checked and saved, and a last-moment database clash (two people saving the same name or email) is also a 409, not a server error. A disabled account cannot change its profile (403). Saving the same values writes nothing.
- **Signing in no longer depends on the email in the token.** The sign-in check (`GET /driver/access-driver`) and the token refresh looked the driver up by the email inside the token, so a driver who changed their email would have been signed out at the next check, and their refresh would have failed. Both now look the driver up by id (tokens without an id still use the email), and `access-driver` answers with the current name and email from the database instead of the ones the token was issued with. A driver who edits their email stays signed in on every device; the next sign-in uses the new email.
- The log line for a save has the driver id and the field names that changed, never the values.

**Database.** None. No migration.

**Config and dependencies.** None.

**Money impact.** None. No pay, rate, deduction or Excel logic is changed.

**Tested.**
- Backend unit tests for the rules (`driverProfileRules.test.js`) and a database test (`PAYROLL_TEST_DB=1`, `driverProfileController.test.js`) that runs the real controllers on made-up drivers (removed afterwards): a good edit of all three, the old token still working after the email change, bad values, a name or email another driver has (case and spacing changed), a case-only change of the driver's own name, an id in the body ignored, a disabled account, an unknown driver. It fails on the old `driverController.js` and passes now. Whole backend suite without the database: 317 pass, 0 fail.
- Frontend tests (`Profile.test.jsx`, 6): view, edit and save, the header name updates, the body holds only the three fields, a refusal shows next to its field and keeps what was typed, Cancel, the load failure with Try again, Spanish. Whole frontend suite: 587 pass. `vite build` and ESLint on the changed files pass.
- By hand, with the real backend on the local database and the real login page in a phone-size window: GET and PUT as the driver, with no token, with an admin token, with bad input in Spanish, with another driver's email and name, and with another driver's id in the body (that driver unchanged); then the page itself: Edit, bad email and phone (messages next to the fields), a good save (toast, new values), reload (still signed in), the header menu entry. The temporary drivers were removed.
- Not tested: a real phone or the mobile app shell, other browsers, a driver with an Everee worker already linked.

**Risks and follow-ups.**
- **Name is how weekly reports and carrier claims find a driver.** `weeklyExcelQueries` matches an Excel row to a driver with `d.name = we.match_name` (and claims by name, #177). If a driver renames themselves and the next weekly file still carries the old name, that driver's rows will not match. Admins already face this when they rename a driver; now drivers can too, so the Edit form shows a notice telling them to tell their admin. Worth a look by Jasil, who owns that zone, whether a name change should be flagged to admins (for example on the Users page) or whether the match should move to the driver code.
- **Everee and QuickBooks keep their own copy.** A worker already created at Everee, or a vendor at QuickBooks, keeps the old name, email and phone: NASA does not push the change. The link is by the worker's id, so it does not break, and Everee's own screens collect the legal name and tax details themselves. Everee off in production for now, so nothing visible changes yet. Before turning it on, decide whether to send the change on.
- **The payment-setup lock still wins.** A driver locked into payment setup (Everee or QuickBooks enforcement on) is sent to that page from any other, including Profile. The setup page still says to ask the admin when the driver's own phone or email is missing; with this page that text could point to Profile instead. Not changed here, because it touches the payment gate.
- Changing the email does not ask for the current password. The sign-in token is short-lived, and a stolen session could change the email but not use it without the password; add a password check if the owners want one.

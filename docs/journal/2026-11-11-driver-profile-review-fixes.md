# Driver profile: fixes after Jasil's review of #278

| Field | Value |
|---|---|
| Date | 2026-11-11 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / #278 (follow-up commit on the same branch) |
| Branch | `feat/driver-profile-edit` |
| Type / scope | `fix(drivers)` |
| Files touched | Backend: `services/driver/profileQueries.js`, `services/driver/passwordAttempts.js` (new), `middlewares/loginRateLimit.js` (two helpers exported), `controllers/driver/profileController.js`, `controllers/driver/updatepasswordController.js`, `services/admin/dbQueries.js` (`getDriverByEmail`), `services/payments/contactReview.js` (new), `services/payments/contactSnapshot.js` (new), `middlewares/sanitize.js` (one word added), `tests/quickbooksVendors.test.js` (its fake database), `controllers/payroll/contactReviewController.js` (new), `routes/payrollRoutes.js`, `services/payments/everee/driverOnboarding.js`, `services/payments/everee/workerStore.js`, `services/payments/everee/onboardingReadiness.js`, `services/payments/quickbooks/driverOnboarding.js`, `services/payments/quickbooks/vendorStore.js`, `locales/backend/en.js` and `es.js`, migration `2026-11-11-driver-contact-review.sql` and its rollback, new tests `driverContactReview.test.js` and `driverPasswordAttempts.test.js`, changed tests `driverProfileController.test.js`. Frontend: `redux/slice/driver/profileSlice.js`, `components/Drivers/Profile.jsx`, `components/Drivers/QuickbooksSetup.jsx`, `components/Admin/PaymentSetupOverview.jsx`, `components/Admin/payRuns/QuickbooksPanel.jsx`, `hooks/translation.js`, and their tests |
| Reserved files touched | None |

**What and why.** Jasil asked for three changes before #278 can merge.

1. **A driver's own email and phone must not feed payroll linking unchecked (P1).** Everee and QuickBooks find a person by exactly their email or phone, and the Profile page now lets a driver change both.
   - *Sign-in email:* changing it now needs the driver's current password (checked with bcrypt under the row lock, before anything else). A missing password is a 400, a wrong one a 403 (not 401, which would make the app try to refresh the session). Name and phone alone need no password.
   - *Hold:* a new column `drivers.contact_changed_at` is set when the email or phone changes. While it is set, and the driver has no live link, the driver is held out of linking. Everee self setup (status shows needs-review, reason `contact_changed`; the driver's Start writes and asks Everee nothing), the Everee admin Look up and Link, QuickBooks self setup, and the QuickBooks admin Look up and Link all refuse. A driver who is already linked is not affected.
   - *Confirm:* a super admin checks the new details and presses "Confirm contact details" (Driver payment setup page for Local drivers, QuickBooks panel for Desi drivers). The button sends the time the admin was shown. If the driver changed their details again since, the server refuses (409) and nothing is cleared, so nobody confirms details they have not seen. The new endpoint is `POST /admin/payroll/drivers/confirm-contact` (super admin, city checked, under the driver's lock).
   - The driver is told on the Profile page that an admin checks a new email or phone before payment setup continues.
2. **Profile answers from an earlier sign-in are ignored (P1).** Every profile request remembers which sign-in it was made for. Signing out starts a new one at the very first moment of the logout, so a read or save that finishes later neither refills the cleared profile nor changes the name in the header. The header update moved into the save itself, behind the same check.
3. **One email per driver ignoring letter case, also when saves overlap (P2).**
   - A profile save of an email takes a lock per email (any letter case) before it checks, so two saves of the same email at once are strictly one after the other and the second is told it is taken.
   - The admin create and edit checks (`getDriverByEmail`) now ignore letter case too, with an exact match first so a driver never clashes with themselves.
   - The migration also adds a unique index on `lower(email)`, but only when no two drivers already clash (see Database).

**Database.** Migration `Backend/migrations/2026-11-11-driver-contact-review.sql`, safe to run more than once, rollback `2026-11-11-driver-contact-review.rollback.sql`. Back up first and run it on a copy first.
```sql
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS contact_changed_at timestamptz;
-- then, only if no two drivers share an email ignoring case (otherwise a NOTICE lists their ids and nothing is created):
CREATE UNIQUE INDEX IF NOT EXISTS drivers_email_lower_key ON drivers (lower(email));
```
Rollback: `DROP INDEX IF EXISTS drivers_email_lower_key; ALTER TABLE drivers DROP COLUMN IF EXISTS contact_changed_at;` (roll the code back first; it reads this column). The new column is NULL for every existing driver, so no one is held until a driver edits their contact. **Run the migration before deploying this backend.** On my local copy the index was not created because two drivers share an email ignoring case (ids 510 and 517); the production data has not been checked.

**Config and dependencies.** None. No new environment variable or package.

**Money impact.** None. No pay amount, rate, deduction, Excel import or payment logic changes. The only effect on payments is that a driver who changed their own email or phone cannot be newly linked until a super admin confirms it.

**Tested.**
- Database tests (`PAYROLL_TEST_DB=1`): `driverProfileController` (password required and checked, a name or phone change needs none, the flag is set only by an email or phone change, two overlapping saves of the same email, and a save waits while that email is locked, which fails when the lock line is removed), `driverContactReview` (all four linking paths refused while held and Everee/QuickBooks never called, a linked driver unaffected, the readiness page shows the reason and time, confirm refused for a non-super admin, a bad or stale time, another city and a second click, and works once with the right time), plus the existing Everee, QuickBooks, readiness, gate and transfer tests: 81 passed, 1 skipped (a commit-mode test that needs a throw-away database).
- Backend suite without the database: 317 passed, 0 failed.
- Frontend: 595 passed in 66 files, production build and lint of the changed files pass. New cases cover the password field (shown only for an email change, cleared after each request, a refusal next to the field), the sign-out guard (a read and a save finishing after sign-out change nothing; the two tests fail when the guard is removed), the admin Confirm buttons (the time is sent back, a refusal is shown) and the Desi driver's review message.

**Not tested.** Real Everee or QuickBooks; a click-through in a browser; a phone or the mobile app; a database that already holds two drivers with the same email in different letter case (the index step only prints a notice there).

**Risks and follow-ups.**
- Checking the current password on the Profile page **and on Change password (`/driver/update-password`, which checks it too)** is limited per driver, with one shared count so neither route can be used to keep guessing (not per address or per email in the request, which the caller chooses): 5 checks in 15 minutes, then a 429 even for the right password, until the window ends. It uses the same Redis counters as sign-in (memory while Redis is down); a correct password clears the count. Sign-in is not affected. Someone holding a stolen session can lock the real driver out of changing their email for 15 minutes, but not out of signing in.
- The link itself is written a moment after the lookup that checked the hold. A driver who saves a new phone in between could still be linked from the old match; the new details are held from then on. Closing that gap would mean re-checking inside the link transaction.
- A Desi driver under QuickBooks enforcement who changes their email is locked to the setup page until a super admin confirms it.
- An admin editing a driver in Users neither sets nor clears the hold; only the driver's own edit sets it and only "Confirm contact details" clears it.
- The Everee and QuickBooks records of an already linked driver keep their old email and phone, as before.
- Changing the name can still stop weekly reports and claims from finding a driver by name (Jasil traced the active paths: the weekly upload uses driver code and claims use Delivery ID, so the older name join is outside the active path).

## Second review round (Jasil's re-review of 1021f5b)

1. **A contact change while a link is being made.** Every place that writes a link now works from one snapshot of the driver's email and phone, taken when the provider call starts, and rechecks it under the driver lock just before saving (`contactStillVerified`: same email and phone, and `contact_changed_at` empty). If the details changed, nothing is linked.
   - Everee admin Link and the sandbox test worker: the driver is loaded once and the same copy is used by the lookup and by the check.
   - QuickBooks admin Link: same.
   - Everee self setup (`saveLink`, used by Start and by background recovery): the claim is let go without marking a review, so after a super admin confirms, the next Start finds the worker made earlier by our own ID and links it.
   - QuickBooks self setup: the status and the provider calls now use the one driver loaded at the start (before, the status and the details sent were read separately), and the link is refused with `needs_review` / `contact_changed`.
   - **Known gap:** in QuickBooks the vendor already exists by the time the check fails. It stays unlinked, its ID is written to the log (warn, with the driver id only), and if the driver changed their email in that same moment, the next setup would not find it by the new email. A super admin must link or remove that vendor by hand; the log line says which.
2. **`currentPassword` uses the credential cleaner.** `middlewares/sanitize.js` cleaned `password`, `oldPassword`, `newPassword` and `confirmPassword` with the old password rules, because stored hashes stand for the text cleaned that way. `currentPassword` went through the general cleaner instead, so a valid password containing, for example, an `onclick=` or an HTML comment reached bcrypt differently on the Profile page than on sign-in. It is now in the same list. The regression test sends such a password through the real middleware and then the controller; it fails without the change.
3. **The admin sees what is being confirmed.** The Driver payment setup page and the QuickBooks panel show the driver's new email and phone next to the button, only for a driver whose details are held (no other driver's contact is added to those responses). The button still sends the time shown.

**Index.** The unique index on `lower(email)` is not active wherever two drivers already share an email in different letter case: the migration prints their ids and skips it. On the local test copy it was skipped (ids 510 and 517). Before relying on it, fix any clashes in the target database, run the migration again and confirm: `SELECT indexname FROM pg_indexes WHERE indexname = 'drivers_email_lower_key';` returns one row. Until then the app-level rules (lock per email, case-insensitive checks in the profile and admin forms) are the only protection, and a write that bypasses the app is not stopped.

**Tested.** Backend without the database: 318 passed, 0 failed. Database tests: 85 passed, 2 skipped (commit-mode tests that need a throw-away database). New: a contact change in the middle of each of the four link paths leaves no link (this fails when the recheck is removed); the QuickBooks fake-database refusal; the sanitizer regression; the contact shown to the admin. Frontend: 595 passed, lint passes.

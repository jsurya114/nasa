# Driver profile: fixes after Jasil's review of #278

| Field | Value |
|---|---|
| Date | 2026-11-11 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / #278 (follow-up commit on the same branch) |
| Branch | `feat/driver-profile-edit` |
| Type / scope | `fix(drivers)` |
| Files touched | Backend: `services/driver/profileQueries.js`, `services/driver/passwordAttempts.js` (new), `middlewares/loginRateLimit.js` (two helpers exported), `controllers/driver/profileController.js`, `services/admin/dbQueries.js` (`getDriverByEmail`), `services/payments/contactReview.js` (new), `controllers/payroll/contactReviewController.js` (new), `routes/payrollRoutes.js`, `services/payments/everee/driverOnboarding.js`, `services/payments/everee/workerStore.js`, `services/payments/everee/onboardingReadiness.js`, `services/payments/quickbooks/driverOnboarding.js`, `services/payments/quickbooks/vendorStore.js`, `locales/backend/en.js` and `es.js`, migration `2026-11-11-driver-contact-review.sql` and its rollback, new test `driverContactReview.test.js`, changed tests `driverProfileController.test.js`. Frontend: `redux/slice/driver/profileSlice.js`, `components/Drivers/Profile.jsx`, `components/Drivers/QuickbooksSetup.jsx`, `components/Admin/PaymentSetupOverview.jsx`, `components/Admin/payRuns/QuickbooksPanel.jsx`, `hooks/translation.js`, and their tests |
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
- Checking the current password on the Profile page is limited per driver (not per address or per email in the request, which the caller chooses): 5 checks in 15 minutes, then a 429 even for the right password, until the window ends. It uses the same Redis counters as sign-in (memory while Redis is down); a correct password clears the count. Sign-in is not affected. Someone holding a stolen session can lock the real driver out of changing their email for 15 minutes, but not out of signing in.
- The link itself is written a moment after the lookup that checked the hold. A driver who saves a new phone in between could still be linked from the old match; the new details are held from then on. Closing that gap would mean re-checking inside the link transaction.
- A Desi driver under QuickBooks enforcement who changes their email is locked to the setup page until a super admin confirms it.
- An admin editing a driver in Users neither sets nor clears the hold; only the driver's own edit sets it and only "Confirm contact details" clears it.
- The Everee and QuickBooks records of an already linked driver keep their old email and phone, as before.
- Changing the name can still stop weekly reports and claims from finding a driver by name (Jasil traced the active paths: the weekly upload uses driver code and claims use Delivery ID, so the older name join is outside the active path).

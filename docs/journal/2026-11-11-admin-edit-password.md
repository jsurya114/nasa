# Editing an admin or super admin: the new password is now saved

| Field | Value |
|---|---|
| Date | 2026-11-11 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `fix/admin-update-password` |
| Type / scope | `fix(admins)` |
| Files touched | `Backend/controllers/admin/addAdminController.js`, `Backend/services/admin/dbQueries.js`, `Backend/tests/adminUpdatePassword.test.js` (new) |
| Reserved files touched | None |

**What and why.** On the Admins page, the Edit form for an admin or super admin has a "New Password (leave blank to keep current)" box and sends what is typed. The server ignored it: `updateAdmin` read only the name, email, role and cities, so everything else saved, the old password stayed, and signing in with the new one answered "Invalid password". (Drivers were not affected: the driver edit already saved a new password.)

Now the server reads `password` on edit. Missing, `null` or blank keeps the current password. Anything that is not text is a 400 ("Password must be text"). Otherwise it is hashed with bcrypt exactly as typed, the same as when an admin is created, so sign-in compares the same text, and saved in the same transaction as the rest of the edit (`password = COALESCE($5, password)`). The hash is computed before the transaction starts, so the connection is not held while bcrypt runs. The password never goes into a log or a response.

An admin whose password was "changed" before this fix still has the old one: edit them again and type the new password.

**Database.** None. Same `admin.password` column, no migration.

**Config and dependencies.** None.

**Money impact.** None.

**Tested.** A database test (`PAYROLL_TEST_DB=1`, `adminUpdatePassword.test.js`) runs the real update and the real sign-in handler on a made-up admin and a made-up super admin (removed afterwards): the old password works, a blank, missing or null password keeps it, a non-text password is refused and nothing changes, a new password lets them sign in and the old one stops working, spaces are kept as typed, role and other fields are right.

**Risks and follow-ups.**
- An admin who is signed in when their password is changed stays signed in until their token expires (15 minutes) or they sign out; tokens are not revoked on a password change (same as the driver side).
- The server does not check a minimum length on edit, the same as when an admin is created.
- A super admin still cannot edit their own account here (existing rule), so they cannot change their own password from this form.

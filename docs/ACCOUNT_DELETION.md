# Account deletion

| Field | Value |
|---|---|
| Status | Built, 27 Nov 2026. Retention and the completion period need the owner's confirmation (section 4). |
| Why | Admins create accounts inside the app, so App Store guideline 5.1.1(v) applies: people must be able to start deleting their account in the app. https://developer.apple.com/support/offering-account-deletion-in-your-app/ |

## 1. Flow

1. A signed-in driver or admin opens **Delete account** (driver profile and menu; admin menu). It is reachable before the driver agreement and payment setup are finished.
2. They read what is removed and what is kept, type their password, and confirm. `POST /driver/account-deletion` or `POST /admin/account-deletion` records one open request. They can withdraw it while it is open.
3. A super admin sees open requests under **Deletion requests** and completes each one (`POST /admin/account-deletions/:id/complete`). NASA commits to completing within 30 days (`COMPLETION_DAYS`).
4. Completion, in one database transaction:
   - switches the account off and replaces the sign-in email (`deleted-<type>-<id>@deleted.invalid`) and the password (random), so nobody can sign in or refresh a session again; an access token already issued expires within 15 minutes;
   - removes the driver's phone number, the admin's city access and Invoices access;
   - switches off every phone registered for push for that account.

## 2. Safeguards

- Asking needs the current password; the request is one per account.
- The last active super admin cannot ask, and no completion can remove the last active super admin.
- A super admin cannot complete their own request; another super admin must.

## 3. What is kept, and why

The account row and id, the name, the driver code, deliveries, availability history, pay statements, payments, claims, insurance and audit history are **not** deleted. They are business and accounting records that NASA must keep and that other people's pay depends on. Nothing is cascade-deleted.

Records held by Everee (pay, tax, bank) and QuickBooks (vendor, bills) are held by those providers under their own policies; completing a NASA deletion does not delete them. NASA staff contact the provider when a person asks.

## 4. Owner decisions (open)

- How long the kept records are kept (no period is set here; do not invent one).
- Whether the name on kept records should be replaced as well (today it is kept, because statements and tax forms need it).
- The 30-day completion commitment.
- Whether provider records should be closed with Everee and QuickBooks as part of completion.

## 5. Running it

Run `Backend/migrations/2026-11-27-account-deletion.sql` (back up first, test on a copy). Rollback: `...account-deletion.rollback.sql`. Tests: `Backend/tests/accountDeletion.test.js` (needs a throwaway `*_test` database).

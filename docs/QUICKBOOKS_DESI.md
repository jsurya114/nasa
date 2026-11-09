# QuickBooks for Desi (1099) drivers

Desi drivers are 1099 contractors recorded in QuickBooks Online. Status: parts 1 and 2 (connection and vendor links). Paying and onboarding through QuickBooks come in later parts. Everything is off by default.

## Settings (Backend `.env`, never in the repository or a chat)

- `QUICKBOOKS_ENABLED=true` turns the connection on. `QUICKBOOKS_ENVIRONMENT` is `sandbox` or `production`; production also needs `QUICKBOOKS_PRODUCTION_APPROVED=true` (owner approval).
- `QUICKBOOKS_CLIENT_ID` and `QUICKBOOKS_CLIENT_SECRET` come from the owner's Intuit developer app (use its sandbox keys for sandbox).
- `QUICKBOOKS_REDIRECT_URI` must be `https://<backend host>/admin/payroll/quickbooks/callback` and the same address must be added to the app's Redirect URIs at Intuit.
- `QUICKBOOKS_TOKEN_KEY` is 64 hex characters (`openssl rand -hex 32`). It encrypts the saved tokens. Losing it only means reconnecting QuickBooks.

## Connect and link (super admin)

1. Apply `Backend/migrations/2026-11-10-quickbooks-connection.sql` on a copy first (rollback file included).
2. Payroll → Pay runs → "Deduction limit & payment setup" → QuickBooks (Desi drivers) → Connect QuickBooks. Sign in to the company and approve. The refresh token lasts about 100 days; reconnect when the panel says it expires soon.
3. Choose a city. For each Desi driver, Look up finds the vendor whose email exactly matches the driver's email (never the name). Link only the single exact match. A vendor already linked to another driver is never offered. A vendor not marked for 1099 tracking in QuickBooks links with a warning: its payments would be missing from the 1099 report.
4. NASA never stores a tax ID. Existing vendors already hold theirs in QuickBooks.

## Testing

Use a QuickBooks sandbox company first. Check: connect, Test connection shows the company name, look up a driver with a matching vendor, link, unlink with a reason, and a driver with no email is blocked.

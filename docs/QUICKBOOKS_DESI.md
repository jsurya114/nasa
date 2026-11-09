# QuickBooks for Desi (1099) drivers

Desi drivers are 1099 contractors recorded in QuickBooks Online. Status: parts 1 to 3 (connection, vendor links, paying Desi drivers). Desi onboarding in the driver portal comes in part 4. Everything is off by default.

## Settings (Backend `.env`, never in the repository or a chat)

- `QUICKBOOKS_ENABLED=true` turns the connection on. `QUICKBOOKS_ENVIRONMENT` is `sandbox` or `production`; production also needs `QUICKBOOKS_PRODUCTION_APPROVED=true` (owner approval).
- `QUICKBOOKS_CLIENT_ID` and `QUICKBOOKS_CLIENT_SECRET` come from the owner's Intuit developer app (use its sandbox keys for sandbox).
- `QUICKBOOKS_REDIRECT_URI` must be `https://<backend host>/admin/payroll/quickbooks/callback` and the same address must be added to the app's Redirect URIs at Intuit.
- `QUICKBOOKS_PAYMENTS_ENABLED=true` (with `QUICKBOOKS_ENABLED`) lets a pay run record Desi payments in QuickBooks. While it is on, Desi drivers can no longer be recorded as Cash in Hand: the server refuses it, so every Desi payment reaches QuickBooks and the 1099 reports.
- `QUICKBOOKS_TOKEN_KEY` is 64 hex characters (`openssl rand -hex 32`). It encrypts the saved tokens. Losing it only means reconnecting QuickBooks.

## Connect and link (super admin)

1. Apply `Backend/migrations/2026-11-10-quickbooks-connection.sql` on a copy first (rollback file included).
2. Payroll → Pay runs → "Deduction limit & payment setup" → QuickBooks (Desi drivers) → Connect QuickBooks. Sign in to the company and approve. The refresh token lasts about 100 days; reconnect when the panel says it expires soon.
3. Choose a city. For each Desi driver, Look up finds the vendor whose email exactly matches the driver's email (never the name). Link only the single exact match. A vendor already linked to another driver is never offered. A vendor not marked for 1099 tracking in QuickBooks links with a warning: its payments would be missing from the 1099 report.
4. NASA never stores a tax ID. Existing vendors already hold theirs in QuickBooks.

## Testing

Use a QuickBooks sandbox company first. Check: connect, Test connection shows the company name, look up a driver with a matching vendor, link, unlink with a reason, and a driver with no email is blocked.

## Paying Desi drivers (part 3)

1. Apply `Backend/migrations/2026-11-10-quickbooks-payments.sql` on a copy first (rollback file included).
2. In the QuickBooks panel choose the expense account (the pay is booked there) and the bank account (the payment is recorded from there).
3. Pay to drivers → Desi drivers. The method is fixed to QuickBooks. The preview shows who can be recorded and what blocks anyone: not Desi, no linked vendor, a vendor not marked for 1099, $0 statements, or a statement already in a batch. Pick the payment date and press Pay.
4. For each driver NASA first asks QuickBooks for a bill with the number `NASA-S<statement id>`. If none exists it creates the bill (one line, the statement's net amount, booked to the expense account), then records a bill payment from the bank account as a check (not a credit card, which QuickBooks leaves out of 1099 totals). It then reads the bill again and requires a zero balance. Only then is the statement marked paid, with the reference `QuickBooks bill <id>`.
5. A refused request is "Not recorded"; a timeout or server error is "Not confirmed". **Retry is always safe**: the bill is found by its number and its balance, so a bill or payment that did land is never made twice. A bill with that number for another vendor or amount is never trusted and needs a person in QuickBooks.

NASA records the payment in QuickBooks; it does not move money. Pay the driver through your bank or QuickBooks as usual. The 1099-NEC itself is filed from QuickBooks.

Sandbox checks: two drivers recorded and shown as Recorded in QuickBooks; a refused payment retried to success with one bill; the same confirmation twice records once; Local drivers and non-1099 vendors are blocked; Desi cash is refused while payments are on.

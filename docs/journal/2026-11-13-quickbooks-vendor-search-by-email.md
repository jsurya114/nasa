# QuickBooks vendor search: QuickBooks cannot filter vendors by email

| Field | Value |
|---|---|
| Date | 2026-11-13 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `fix/quickbooks-vendor-lookup-by-email` |
| Type / scope | `fix(payroll)` |
| Files touched | Backend: `services/payments/quickbooks/quickbooksClient.js`, `tests/quickbooksFoundation.test.js`. Journal entry. |
| Reserved files touched | None |

**What and why.** The first real QuickBooks connection (production, 12 Nov 2026) showed that "Look up" on the Payroll page failed with `QueryValidationError: property 'PrimaryEmailAddr' is not queryable`. QuickBooks does not allow a vendor query to filter by email, and `findVendorsByEmail` did exactly that. The tests used a fake QuickBooks, so it was never seen before.

- `findVendorsByEmail` now reads the active vendors page by page (1000 per page, `orderby Id`, `startposition`) and keeps the ones whose email equals the driver's, ignoring letter case and spaces. The function still returns only matching vendors, so its two callers (the admin Look up and the driver's own QuickBooks setup) work as before, and `lookupVendor` still re-checks the email.
- If the company has more than 20,000 active vendors, the search stops with an error ("too many vendors to search by email") instead of answering "none found". A wrong "none found" would let a second vendor be created and split the driver's 1099 total, so failing is the safe answer.
- Tests: the vendor search never puts the email in the query, reads a second page, matches ignoring case and spaces, skips vendors without an email, and fails when the cap is reached. One older assertion was updated: a vendor with no email address is no longer returned as a match.

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None. No amount, rate or payment logic changes. Look up and driver setup only read vendors.

**Tested.**
- Backend suite without the database: 417 tests, 320 passed, 0 failed (the rest need the database and are skipped).
- QuickBooks foundation, vendor and onboarding tests: 26 passed, 0 failed.

**Not tested.** Against the real QuickBooks company: the new query syntax (`where Active = true orderby Id startposition N maxresults 1000`) follows Intuit's query language and the existing account query, but a live Look up still has to be tried after deployment. A company with thousands of vendors (each page is one request).

**Risks and follow-ups.**
- A company with many vendors makes several requests per Look up (one per 1000 vendors, at most 20).
- The driver setup (`driverOnboarding.js`) uses the same function, so it benefits from the same fix.
- Listing the vendors by name instead of reading all of them would be lighter if a company ever has very many; not needed now.

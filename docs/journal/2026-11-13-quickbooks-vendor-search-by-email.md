# QuickBooks vendor search: QuickBooks cannot filter vendors by email

| Field | Value |
|---|---|
| Date | 2026-11-13 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `fix/quickbooks-vendor-lookup-by-email` |
| Type / scope | `fix(payroll)` |
| Files touched | Backend: `services/payments/quickbooks/quickbooksClient.js`, `vendorStore.js`, `driverOnboarding.js`; tests `quickbooksFoundation`, `quickbooksVendors`, `quickbooksOnboarding`, `driverContactReview`. Journal entry. |
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

## Review round (Jasil's review of #283)

1. **One company for the whole search and the write (P1).** Every page of the vendor scan went through `auth()` again, so a reconnect to another QuickBooks company between pages could mix two companies, and the result could then drive a link or a new vendor.
   - `request()` takes an optional `realm`. If the connection's company differs from it, nothing is sent and a `QuickbooksError` is thrown. A token refresh for the same company is unaffected.
   - `findVendorsByEmail(email, { realm })` pins every page to that company (the one in `quickbooks_connection`) and returns the list with `realmId`. `createVendor(body, requestId, { realm })` is pinned the same way.
   - Admin Look up and Link (`vendorStore.js`): the lookup reads the connected company first, pins the search, refuses an answer for another company, and returns the company it used. The link is saved with that company, and is refused (409) if another company was connected since the lookup. The "already linked to another driver" check now uses the same company.
   - Driver self setup (`driverOnboarding.js`): the search and the vendor creation are pinned to the company read at the start, which is the one the link is saved with.
2. **A broken page is an error, not the end of the list (P2).** The scan now uses a strict query: the answer must contain a `QueryResponse` object (an empty list is `{}`), and `Vendor`, if present, must be a list. An unreadable body, a missing `QueryResponse`, a Fault inside a 200 answer, or a later page that fails is a provider error, never "no vendors".
3. **An inconsistent set of pages is an error.** The company's active vendor count is read before and after the scan; a vendor Id that appears twice, or a number read that differs from either count, fails the search ("vendors changed while they were being read; try again"). The 20,000-vendor cap is also checked up front from the count.

Tests: the empty valid list; each kind of broken later page (unreadable body, no `QueryResponse`, null, wrong type, Fault in a 200, a refusal); a missing count; a repeated vendor; a count that grows or does not match; a reconnect to another company between pages (nothing is sent to the second company); a pinned company that differs; `createVendor` pinned; the admin lookup and link refuse another company, and the link is saved in the company searched; the driver setup passes the company to both calls. The company pin, the strict page check and the count check were each removed in turn and a test failed (the repeated-vendor check is also caught by the count check, so removing it alone changes no test). Older test fakes now report the company they searched (the real client always does).

**Tested (after the review round).** Backend suite without the database: 422 tests, 325 passed, 0 failed. Database tests on a local copy, one file at a time (QuickBooks onboarding, vendors, contact review, foundation): 40 passed, 0 failed.

**Not tested.** Against the real QuickBooks company: the count query (`select count(*) from Vendor where Active = true`, answered as `totalCount`) and the paged query follow Intuit's documented query language, but a live Look up still has to be tried after deployment. If the count answer differs from what the code expects, Look up fails closed with a clear error, it does not guess.

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

## Review round 2 (Jasil: carry the lookup fix through the driver's QuickBooks setup and verify it end to end)

The client confirmed that Desi drivers finish their own QuickBooks setup in the driver portal. The portal already had the form (`QuickbooksSetup.jsx`) and the service (`driverOnboarding.js`); this round checked it against the three requirements and fixed what it found.

**Found and fixed: the admin Link failed for any Desi driver with a phone number.** `vendorStore.js` loaded the driver without `phone_number`, so the contact snapshot held no phone, and the check under the driver's lock (email and phone must be unchanged) saw the stored phone as a change: "this driver's email or phone changed while linking; nothing was linked". This is also on `main`. It only showed once the whole path ran against a real database, because the unit tests use a driver without a phone. The driver is now loaded with `phone_number`, as the Everee link already does. A driver without a phone was not affected.

**Checked, and already met after the lookup fix:**
1. A new Desi driver gives legal name, address, tax ID and the certification, and finishes setup in NASA. No bank account or routing detail is asked for or sent. One 1099 vendor is created with the driver's own NASA email, and no tax ID is kept.
2. A driver who already has a QuickBooks vendor is never given a second one. Setup scans the vendors by email first. Any match (one or several) goes to review for a super admin, nothing is created or linked by the driver (a driver cannot prove they own an existing record). The admin's Look up then answers `match` for one exact, unlinked vendor and Link saves it (source `existing_vendor`), or answers `ambiguous` / `no_match` and links nothing. Retrying never creates another vendor: after a lost answer the retry finds the vendor QuickBooks already made and goes to the same review.
3. Completing setup only reads and creates vendors. It never creates a bill or a payment.

**Not changed (decision for Jasil).** Setup does not link a single clean match by itself; an admin presses Link. This follows the Everee onboarding rule that a driver cannot prove ownership of an existing record, and a wrong link would put one person's 1099 payments on another vendor. The driver sees "your admin needs to confirm it" and the form again; no review state is stored, so the admin finds the driver in the Unlinked list of Driver payment setup. A stored "waiting for review" state would need a database table and was left out.

**Tests added** (`quickbooksOnboarding.test.js`, against a local database copy and the real QuickBooks client talking to a stateful stand-in for one QuickBooks company that refuses a vendor query filtered by email, as production did, keeps created vendors, repeats the first answer for the same request id, and records any request that is not a vendor read or create):
- a new Desi driver: one 1099 vendor, linked, no bank detail sent, a second try refused, no payout;
- a driver with an existing vendor: two retries create nothing, the admin Look up finds the vendor, Link completes setup, one vendor remains;
- two vendors with the driver's email: review, ambiguous, nothing linked or created;
- QuickBooks made the vendor but the answer was lost: the retry does not create another, the admin links the one that exists.
`quickbooksVendors.test.js`: a driver with a phone number can be linked.
Undoing the phone fix fails 4 tests; setup ignoring an existing vendor fails 7.

**Tested (after round 2).** Backend suite without the database: 423 tests, 326 passed, 0 failed. Database tests on a local copy, one file at a time: onboarding 12, vendors 17, foundation 14, contact review 2, all passed. Frontend driver setup flow test: 6 passed.

**Not tested.** The real QuickBooks company (the stand-in follows Intuit's documented behaviour, including the email-filter refusal seen in production and the repeated request id), and a real browser click-through of the portal form on a phone. The count query is still to be tried live after deployment.

## Review round 3 (Jasil: bind the admin's Link to the company shown in Look up)

**Found and fixed.** The Link request sent only the vendor ID. The server compared the company at the start and end of its own fresh search, so a reconnect to another company between the admin's Look up and Link could still accept the same vendor ID from the other company, although the admin had reviewed the first company's record.

- The Look up answer now includes `realmId`, the QuickBooks company it was read from (null when it was blocked before asking).
- The Link request must send that `realmId` back (`400` if it is missing). The server runs its fresh lookup and refuses with `409 "the QuickBooks company changed since the lookup"` if that search was answered by a different company, before anything is written. The link is still saved in the company that was searched.
- The admin panel keeps `realmId` from the Look up and sends it with Link. The driver's own setup is unchanged (it searches and creates in one request, pinned to one company).

**Tests.** `quickbooksVendors.test.js`: Look up reports the company (null when blocked); a link without a company is refused (undefined, empty, a number); a link confirmed for another company than the connected one is refused and writes nothing. The existing link calls in `quickbooksVendors`, `quickbooksOnboarding` and `driverContactReview` now send the company. `QuickbooksPanel.test.jsx` checks the panel sends it. Database tests on a local copy: vendors, onboarding and contact review, 33 passed, 0 failed (with `PAYROLL_TEST_DB=1 EVEREE_ONBOARDING_ENFORCED=false QUICKBOOKS_ONBOARDING_ENFORCED=false QUICKBOOKS_PAYMENTS_ENABLED=false`). Frontend `QuickbooksPanel`: 7 passed.

**Not tested.** A real company switch in QuickBooks, and a click-through in the browser.

**Database / config / money.** None.

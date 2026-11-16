# A Claims page for every admin: their cities' claims, matched and not matched yet

| Field | Value |
|---|---|
| Date | 2026-11-16 |
| Author | Jayasoorya Suryadas, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / see the pull request |
| Branch | `feat/admin-claims-page` |
| Type / scope | `feat(backend)` and `feat(frontend)` |
| Files touched | Backend: `services/admin/claimsList.js` (new), `controllers/admin/claimsController.js` (new), `routes/adminRoutes.js` (one route); test `claimsList` (new). Frontend: `components/Admin/Claims.jsx`, `components/Admin/claims/claimsApi.js`, `components/Admin/claims/ClaimsTable.jsx` (all new), `App.jsx`, `reuse/Nav.jsx`; tests. Journal entry. |
| Reserved files touched | None. No upload, dashboard or pay file is changed. |

**What and why.** After a weekly Excel upload, the result only counted claims ("waiting for delivery history", "not clear which driver"). An ordinary
admin could not see any claim: the claim rows were only inside the super admin's payroll screens. Admins need to see which claims belong to their city's
drivers and which are not matched yet, with the waybill. There is now a **Claims** page in the menu for every admin.

- **Two lists.** "Not matched yet" (the default): claims with no driver yet, each with why (waiting for delivery history, not clear which driver or city,
  or held because the same claim was entered by hand) and the courier name from the carrier's file. "Matched to a driver": chargeable and exempt claims,
  with the driver's name and code, and a "Deducted" tag once a finalized pay run has taken the claim off pay.
- **Details shown:** waybill, date, claim type, amount, driver (matched) or courier name (not matched), city and status, and the reason when not matched.
- **Who sees what.** `GET /admin/claims`: an ordinary admin gets the claims of the cities assigned to them (the claim's city is the city its file was
  uploaded for); the super admin gets all. A city the admin does not have shows nothing. The admin comes from the token.
- **Also:** a city filter, a search (waybill, driver, claim type, courier name; a `%` or `_` is just a character), 20 a page, and the counts of both lists
  (they follow the city and the search). An amended claim shows once, at its latest amount.
- **Read only.** The page changes no claim, matching, pay run or payment. The only code path added reads `courier_claims`, `courier_claim_matches`,
  `drivers`, `city` and the pay statement lines.

**Database.** None. Read only; no new column, table or index. (The list uses the existing indexes on `courier_claims` and `courier_claim_matches`.)

**Config and dependencies.** None.

**Money impact.** None. Claim amounts are shown as the server holds them; nothing is calculated, deducted or changed.

**Tested.**
- Backend `claimsList` (8 passed on a local copy with `PAYROLL_TEST_DB=1 EVEREE_ONBOARDING_ENFORCED=false QUICKBOOKS_ONBOARDING_ENFORCED=false
  QUICKBOOKS_PAYMENTS_ENABLED=false`): the query's accepted words; the split into matched and unmatched; only the admin's own cities (another city, and an
  admin with no city, show nothing; a super admin sees all and can pick one); only current versions; search; "Deducted" only for a finalized run; 20 a page;
  reading changes nothing. Whole backend suite without the database: 429 tests, 331 passed, 0 failed (98 need the database).
- Frontend: full suite 609 passed; lint of the new files clean; build clean. New tests for the page (both lists, driver and reason, city, search, paging,
  empty, error with retry), the menu link for an ordinary admin and the route outside the super admin guards.

**Not tested.** In a browser against real data, and a real sign-in as an ordinary admin.

**Risks and follow-ups.**
- A claim belongs to the city its file was uploaded for. A claim stored for a city the admin does not have is not shown, even if its driver's city is theirs.
- The page lists claims; it does not resolve them. Resolving an unmatched claim stays with the existing flows (the next upload and rematch).
- Admins now see claim amounts and driver names for their own cities. The super admin's payroll screens are unchanged.

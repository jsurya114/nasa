# Claims page: show the claims entered by hand (daily cities)

| Field | Value |
|---|---|
| Date | 2026-11-27 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR); follows #295 |
| Branch | `fix/claims-show-hand-entered` (from `develop`) |
| Type / scope | `fix(payroll)` |
| Files touched | `Backend/services/admin/claimsList.js`, `Backend/tests/claimsList.test.js`, `Frontend/src/components/Admin/Claims.jsx`, `Frontend/src/components/Admin/claims/ClaimsTable.jsx`, `Frontend/src/components/Admin/Claims.test.jsx`, this entry. |
| Reserved files touched | None. |

**What and why.** The Claims page listed only the carrier's claims from the weekly file (`courier_claims`). Claims an admin enters by hand in Payroll are saved as `manual_claim` entries in the driver's ledger (`driver_ledger_entries`, #142), and the page never read them. Daily cities have no carrier file, so for them the page was always empty although claims had been entered. On production (read only, 27 Nov): 82 live hand-entered claims in daily cities and 3 in weekly cities were missing.

Now the page lists both. A hand-entered claim already names its driver, so it is always under **Matched to a driver**: chargeable, or exempt when it was entered as exempt. It is marked **Entered by hand**, with the admin's note. A voided entry is not listed. Scope is the same as before: an ordinary admin sees their assigned cities (by the entry's city), a super admin sees all. Search finds it by waybill, claim type or driver.

What was taken off pay uses the entry's own recovery lines (`pay_statement_lines`, `line_type = 'recovery'`): deducted and paid out count finalized runs only, as for carrier claims; "left" is the amount less what pay runs (drafts too) and repayments outside payroll (`driver_ledger_settlements`) already took. The answer gains `source` (`file` or `manual`) on each claim.

**Database.** None (read only). **Config and dependencies.** None. **Money impact.** None: the page only reads; no pay or claim rule changed.

**Tested.** Backend: `claimsList.test.js` with `PAYROLL_TEST_DB=1` on a local copy, 13 pass (new: own city only, newest first, voided left out, never unmatched, counted in the matched count, search, super admin sees all, a draft run holds it, a finalized paid run shows it deducted and paid, an exempt one has nothing left); full backend suite 387 pass. Frontend: 671 pass, including the new page test (marked, with its note, and a hand-entered claim with the same id as a carrier claim is its own row); build passes. Production, read only, old and new query side by side: carrier claims unchanged (172 matched, 34 unmatched), plus 85 hand-entered claims (all chargeable), no row twice. **Not tested:** in a browser.

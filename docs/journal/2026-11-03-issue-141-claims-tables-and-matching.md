# Courier claims: tables, import and rematching (issue #141, part 2)

- **Date:** 2026-11-03
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #141 (part of #138) / see the pull request for this branch. Builds on part 1 (claim rules and parser, PR #147).
- **Branch:** `feat/payroll-claims-store` (from `feat/payroll-claim-rules`)
- **Type and scope:** feat(payroll)
- **Files touched:** new `Backend/migrations/2026-11-03-issue-141-courier-claims.sql` and `.rollback.sql`, new `Backend/services/payroll/claims/claimsStore.js`, new test `Backend/tests/claimsStore.test.js`, this journal entry. No reserved files.

**What and why.** Where claims live once parsed, kept so that a claim can never be stored twice and the carrier's evidence is never edited.
- `courier_claims` holds the carrier's facts as imported: courier, identity key, version, waybill, claim type, claim and confirm dates, signed charge, deduction, declared value (evidence only), remarks, the city the file was uploaded for, and the source file, sheet and row. Rows are not edited. A changed amount arrives as a new version, and the old one is marked superseded. A partial unique index allows only one current version per claim.
- `courier_claim_matches` holds what NASA works out from delivery history: status (`unresolved`, `ambiguous`, `chargeable`, `exempt`), driver, city, carrier delivery ID, route, journey date, eligible deduction, reason and rule version. A check constraint makes the database itself refuse an exempt claim with money, a chargeable claim without a driver and city, or an open claim that names a driver.
- `importClaims` saves one parsed file. A claim already stored with the same facts is a duplicate and writes nothing, so re-uploading a file or the same claim in a later week cannot charge twice. Two uploads of one claim at the same moment wait on a per-claim lock.
- `rematchOpenClaims` retries only open claims (unresolved or ambiguous), with a history lookup passed in. That lookup comes from the GOFO waybill history (#140, Jasil). Chargeable and exempt claims are never changed by a rematch, so a driver who later changes city cannot move an old claim.
- Late claims keep their own claim and confirm dates; which pay run they fall into is #143's eligibility cutoff.

**Database.** Additive only. Run `Backend/migrations/2026-11-03-issue-141-courier-claims.sql` (back up first, test on a copy; safe to run twice). Rollback: `...courier-claims.rollback.sql` drops both tables, which deletes imported claim evidence, so back up first. Neither file touches an existing table. **Do not run on production yet**: nothing uses the tables until #140's history lookup and #143 exist.

**Config and dependencies.** None. One new test switch for developers: `PAYROLL_TEST_DB=1` runs the database test (CI skips it, like `PUSH_TEST_DB`).

**Money impact.** None. No existing pay, rate, deduction or import code changes, and nothing applies a deduction. In the test, the matched claims were: a -40 claim amended to -45 deducts 45.00; an exempt DFW GOFO Tracking-interruption claim deducts 0.00; a claim whose waybill has two drivers deducts nothing.

**Tested.**
- Database test against the local copy (`nasa_local`), all inside one transaction that is always rolled back (the migration too). 6 steps, all pass:
  - a new file stores 3 claims as unresolved, with no deduction;
  - the same file again, under a different name, adds nothing;
  - an amended amount gives version 2, with version 1 kept and superseded;
  - rematching gives one chargeable, one exempt (0.00) and one ambiguous (two drivers);
  - a second rematch with changed history leaves the decided claims alone;
  - the database refuses an exempt claim with money, a chargeable claim without a driver, an exempt claim reopened with its driver kept, and a deduction that is not the absolute charge.
- Afterwards, neither table exists in `nasa_local`.
- The migration runs twice cleanly, and the rollback removes both tables (checked in a transaction that was rolled back).
- Whole backend suite: 64 tests, 31 run and pass, 33 database tests skipped as before.

**Not tested.**
- Two real concurrent uploads. The lock is in place, but the test runs in one transaction.
- The history lookup itself (#140).
- Offsets (they come with #140).
- Production data.

**Risks and follow-ups.**
- **Exempt city name**, as in part 1: the rule matches "DFW GOFO", and the local copy has "Dallas GOFO". This needs the owner's confirmation before any claim is matched for real.
- If an amended claim's old version was already applied to a pay run, #143 must add a correcting entry. This part only reports it in `amended`.
- Jasil's side: call `parseClaimsWorkbook` and `importClaims` from the weekly upload, and supply `findCandidates` from the waybill history (#140).

## Review fixes (Jasil's review on #148, 3 Nov 2026)

- **A hand-entered claim and the carrier's claim could both be recovered.** The import took the shared lock but only looked at `courier_claims`. Now, under the same lock, it also looks for a live hand-entered claim (#142, `driver_ledger_entries`, when that table exists) with the same waybill and claim type.
  - If one exists, the carrier's claim is stored (its evidence is kept) with the new status **`review`**, which is never deducted and never rematched. The reason names the ledger entry.
  - Voiding that hand-entered claim calls `releaseHeldClaims`, which puts the carrier's claim back into matching.
  - An amended carrier version is checked the same way.
  - Schema change in this pull request's migration: `courier_claim_matches.status` now allows `review`, with no driver, city or deduction, like the other open states.
  - Both arrival orders, amendment and release are tested on #149, where the ledger table exists.
- **Rematching could stall.** Each call took the same lowest IDs, so claims that stay unresolved at the front blocked every later claim.
  - `rematchOpenClaims` now takes a cursor (`afterId`) and returns `{ counts, nextAfterId }`.
  - `rematchAllOpenClaims` makes one fair pass batch by batch.
  - Both take an optional `waybills` list, so the waybill history import (#140) can rematch only what it touched.
  - Tests: one claim with no history ahead of a matchable one, batch size 1. Three cursor-less calls leave the second claim open (the old behaviour); the sweep matches it. A scoped sweep visits only the given waybill.
- Claims store database test: 9 pass (was 7).

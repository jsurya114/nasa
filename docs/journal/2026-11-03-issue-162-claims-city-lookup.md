# The claims store refuses another city's claim (issue #162)

- **Date:** 2026-11-03
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #162 (follow-up from #141 / #160) / see the pull request for this branch
- **Branch:** `fix/claims-city-lookup` (from `develop`)
- **Type and scope:** fix(payroll)
- **Files touched:** `Backend/services/payroll/claims/claimsStore.js`, `Backend/tests/claimsStore.test.js`, this journal entry. No reserved files. The upload caller from #160 (`recordWorkbookClaims.js`) is unchanged.

**What and why.**
- **The gap.** `importClaims` found the current version of a claim by courier, waybill and claim type only, without the city. An import for city A that named a claim city B already held would have treated it as one of A's: the same facts counted as a duplicate, and different facts created a new version that superseded B's claim.
- **#160 already guards against this.** The weekly upload leaves such claims out before it calls `importClaims`. The store itself still relied on every caller doing that.
- **Now the store refuses it.** Under the same per-claim locks as before, a claim whose current version belongs to another city is not written at all. It is not counted as a duplicate, not amended and does not supersede anything.
- **What the caller gets.** A new `otherCity` list of `{ sourceRow }`. Only the row is given, never the other city's claim ID, so a caller learns nothing about what another city holds.
- **Unchanged:**
  - same-city duplicates, amended versions and `review` holds;
  - the lock keys and lock order;
  - the claim's identity (courier + waybill + claim type). Whether the city should become part of that identity is an owner decision, tracked on #161 with the question of two claims of the same type on one waybill.
- **Database:** None.
- **Config and dependencies:** None.
- **Money impact:** None for any claim of a single city. A claim another city already holds can no longer be changed by an import for a different city, so its deduction can't be moved or replaced that way. The #160 upload already behaved this way.

**Tested.**
- `tests/claimsStore.test.js` on `nasa_local` with `PAYROLL_TEST_DB=1`, inside one transaction that is rolled back, with made-up waybills only: 10 pass.
- The new subtest:
  - city B importing city A's claim with the same facts gives `otherCity` and no duplicate;
  - the same with a changed amount gives no new version, and city A's versions are unchanged;
  - a claim only city B has is still stored for city B;
  - city A can still amend its own claim.
- The new subtest **fails on the code before the fix**.
- Whole backend suite with `PAYROLL_TEST_DB=1`: 136 pass, 0 fail, 36 skipped (push and assignment database flags).
- `weeklyClaimsFlow.test.js` and `assignmentStore.test.js` with `ASSIGNMENT_TEST_DB=1` as well: pass.

**Not tested.**
- Two parallel imports of the same claim for two cities. The check runs under the same advisory locks as the existing import, but it wasn't run in parallel.
- `assignmentHistoryFlow.test.js` with `ASSIGNMENT_TEST_DB=1`: 2 subtests fail on this machine, **identically on `develop` without this change**.
  - The "claims tables missing" subtest drops `courier_claims`, which the pay run tables from #142/#143 depend on in a database where those migrations are applied, so the drop is refused.
  - The next subtest then fails on the aborted transaction.
  - This is a test setup issue to raise with Jasil, not a product problem.

**Risks and follow-ups.**
- The upload's own filter (#160) now does the same job as the store. It can be simplified to rely on `otherCity` later, keeping its city-admin wording ("already recorded"). That file is Jasil's.
- If the owner decides the city is part of claim identity (#161), that becomes a schema change with its own migration.

# Everee, PR 4 review notes: test portability, a misleading set, exact production approval (issue #31)

- **Date:** 2026-11-05
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #31 / the pull request for `feat/everee-submit` (#205), answering the notes in Jasil's review of 2026-11-04
- **Branch:** `feat/everee-submit`
- **Type and scope:** fix(payroll), backend (tests and two small code changes)
- **Files touched:** `Backend/services/payments/everee/batchSubmit.js`, `evereeConfig.js`; tests `evereeSubmit`, `evereeBatchPreview`, `evereeBatchPreviewRules`. No reserved files.

**What changed.**
1. **Test portability (P2).** `evereeSubmit.test.js` no longer asserts that the whole database has no paid rows; it checks the run it created (its statements and the earning rows they include). `evereeBatchPreview.test.js` now applies the migrations its code needs (approved-run payment records and the Everee payments tables), so it no longer depends on the database already having them.
2. **A set that was always empty (note 3).** After the payout request, `requestPayout` built the "taken" set from a number, so it was always empty. It now uses the list of payables Everee named. The behaviour is the same (taken payables already have their payout time set and are excluded by the query); the code now says what it does.
3. **Production approval is compared exactly (note 4).** `EVEREE_PRODUCTION_PAYMENTS_APPROVED` must be exactly `true`; `TRUE` or ` true ` no longer approves live payments. `EVEREE_PAYMENTS_ENABLED` is unchanged (it is also the sandbox switch; its text and use stay as they are).

**Database:** none. **Config and dependencies:** none new. The production approval value must now be written exactly `true`. **Money impact:** none.

**Tested.** The three test files above: 34 pass (the new exact-approval cases fail on the old comparison).

**Not done, and why.** Note 2 (sending a large batch in the background so a proxy timeout cannot cut a request of 100 to 200 drivers; a repeat with the same request ID is already safe) and note 5 (a database trigger that stops `paid` moving to anything else) change how sending and the data guard work and are left for Jasil to decide. Note 6 is the open sandbox item: no payment has reached PAID yet.

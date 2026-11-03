# Make the flow tests independent of which migrations exist

| Field | Value |
|---|---|
| Date | 2026-11-04 |
| Author | Jasil (with Claude Code) |
| Issue / PR | follow-up to #140 and #141 / see the pull request for this branch |
| Branch | `fix/assignment-flow-test-rollback` |
| Type / scope | `fix(excel)` (tests only) |
| Files touched | `Backend/tests/assignmentHistoryFlow.test.js`, `Backend/tests/weeklyClaimsFlow.test.js` |
| Reserved files touched | None. |

**What and why.** Jayasoorya reported that `assignmentHistoryFlow.test.js` failed 3 subtests on a clean `develop` in his database. Reproduced: the "claims tables are missing" step ran `courier-claims.rollback.sql`, which cannot drop `courier_claims` once the ledger, pay-run or #166 tables exist, because they depend on it. A failed statement then aborted the rest of the test's transaction, so the next subtest failed too. It had passed for me only because my scratch database lacked those tables, and `weeklyClaimsFlow.test.js` had the same problem (a list of rollback scripts that went stale as migrations were added).

The tests now hide the table (`ALTER TABLE ... RENAME`) inside their own rolled-back transaction. That produces the same "relation does not exist" condition the code must survive, whichever migrations exist in the test database, and needs no rollback script. The same is done for the history table.

**Money impact.** None. Tests only.

**Tested.** Both flow files (28 tests) on a scratch database with every current migration applied (including ledger, pay runs and #166) and on one with only the history migration: all pass on both. Checked that nothing is left behind (the renamed tables are back, no test city remains). The failing case was reproduced first on the full database.

**Not tested.** Jayasoorya's own database.

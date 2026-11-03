# Settle waiting claims when new assignment history arrives (issue #140, part 3)

| Field | Value |
|---|---|
| Date | 2026-11-03 |
| Author | Jasil (with Claude Code) |
| Issue / PR | `#140` / see the pull request for this branch |
| Branch | `feat/gofo-history-rematch` |
| Type / scope | `feat(excel)` |
| Files touched | `Backend/services/excel/assignmentHistory/recordWorkbookHistory.js`, `Backend/tests/assignmentHistoryFlow.test.js` |
| Reserved files touched | None. |

**What and why.** Claims (#141/#148) are stored first and matched later, because the report that proves who carried a package often arrives afterwards. Part 2 saved that history but nothing re-looked at the waiting claims. Now, after a weekly upload or a history-only import adds evidence (new facts, facts that came back after a void, or a driver or route linked later), every claim still `unresolved` or `ambiguous` is matched again from history, using `rematchAllOpenClaims` with the lookup from part 1.

- Claims already `chargeable`, `exempt` or held for review are never touched (the claims store only updates open ones).
- Nothing is guessed: a claim with no history stays unresolved, a waybill with conflicting history stays ambiguous.
- The rematch is a second step with its own savepoint. If it fails (for example the claims migration has not been run), the history just saved is kept and the answer says `claimsRematched: { failed: true }`.
- The answer carries `claimsRematched`: the counts, or `null` when nothing new could change a claim (a file already recorded adds nothing).

**Money impact.** Indirect: a claim that now matches becomes `chargeable` with a deduction amount. That amount only reaches a driver's pay when a pay run applies it (#143), as before. Nothing is charged here.

**Database.** None. Needs the #140 and #141 migrations already merged.

**Tested.** Flow tests on a private scratch copy (`ASSIGNMENT_TEST_DB=1`, one rolled-back transaction, made-up data): a waiting claim becomes chargeable with the right driver and amount; a conflicting waybill becomes ambiguous; a waybill with no history stays unresolved; a second file with nothing new looks at no claim; with the claims tables missing the history is still saved. Removing the rematch makes two tests fail. Default backend suite: 0 failures.

**Not tested.** The exemption path (a `DFW GOFO` route plus a tracking-interruption claim) needs a DFW GOFO city in the data; the claim rules are covered by #147. Voiding an import does not re-open claims already decided from it; that needs a policy decision.

**Follow-ups.** The upload page does not show `assignmentHistory` or `claimsRematched` yet.

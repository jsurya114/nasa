# Claims matched to drivers by the Courier name, and shown on the dashboard (issue #180)

- **Date:** 2026-11-04
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #180 / see the pull request for this branch. **Stacked on #178** (driver names unique ignoring case and spaces), whose commits it contains until #178 merges.
- **Branch:** `feat/claims-by-courier-name` (from `feat/unique-driver-names`)
- **Type and scope:** feat(payroll), backend and frontend
- **Files touched:**
  - backend, new: `migrations/2026-11-04-issue-180-claim-courier-name.sql` and `.rollback.sql`, `services/payroll/claims/courierNames.js`, tests `courierNames.test.js`; changed: `claimsParser.js`, `claimRules.js`, `claimsStore.js`, `recordWorkbookClaims.js`, `services/excel/assignmentHistory/recordWorkbookHistory.js`, `services/admin/driverName.js` (one export), `statements/periodSummary.js`; tests `claimsParser`, `weeklyClaimsFlow`, `assignmentHistoryFlow`, `periodSummary`;
  - frontend: `Admin/dashboard/penaltyDisplay.js`, tests `PenaltyRows.test.jsx` and `Dashboard.penalty.test.jsx`;
  - this entry. No reserved files are changed (the weekly upload controller already calls `recordWorkbookClaims`).

**The owner's decision (4 Nov 2026).** A claim is matched to its driver **by the driver's name**, not by waybill:
1. the claim's **Courier** (Claims Detail sheet) is the driver's name;
2. the same name is looked up in the **Courier** column of **Details of Delivery Fees** (Offset Details is not used);
3. that row's **Delivery ID** is the driver code, which gives the driver;
4. the amount is **The total expenses-exclusive of taxes** (unchanged).

**How it works.**
- **Names compare like the database does** (#177): cleaned (a fixed set of whitespace becomes one space, ends trimmed) and lower case, so "claims DRIVER d" and "Claims Driver D" are one name.
- **Delivery sheet names:** each row's Courier name and Delivery ID are read (`courierNames.js`). A Delivery ID counts only if it is whole digits that fit a driver code; nothing is rounded or reshaped. A name seen with two different Delivery IDs stays visible.
- **Claim outcomes (`resolveClaim`, same rules as before, new reasons):**
  - name not in this report's Details of Delivery Fees → `unresolved` ("the courier name was not found in Details of Delivery Fees");
  - the name has two Delivery IDs → `ambiguous` ("linked to more than one driver");
  - the Delivery ID is no NASA driver's code → `unresolved` ("not linked to a NASA driver");
  - the driver's city is not the city the file was uploaded for → `ambiguous`;
  - Dallas GOFO + Tracking interruption → `exempt` (0.00); anything else → `chargeable`, amount = the absolute charge.
  - a claim with no courier name cannot be matched and stays `unresolved`.
- **When:** at the weekly upload, every open claim of that city is matched against this report's names, so a claim an earlier report could not match is matched as soon as its driver appears in a later report (the later report needs a Claims Detail sheet). The waybill plays no part.
- **Stored:** `courier_claims` gets `courier_name` and `courier_name_key` (additive migration). A claim stored before this change has no name; if the same claim comes again with a name, it learns the name (no new version) and can be matched.
- **The old waybill-history matching of claims is switched off** (`recordWorkbookHistory` no longer rematches; `claimsRematched` is always null). Waybill history is kept as evidence only.
- **The upload answer** also says how many driver names the report gave (`names`) and how many claims had no courier name (`claimsWithoutName`).

**Dashboard.**
- After **Calculate payment** the pay rows exist, and the **Penalty & Others** figure (the Payroll page's advances and penalties **and** the weekly Excel claims) shows in the driver jobs table, below the insurance deduction, and in the Summary, and comes off the net driver payment. It is the server's estimate of what the next pay run takes, by each record's arrangement.
- **No dates needed:** without dates the estimate covers all the driver's closed, unpaid pay up to today; with dates it behaves as before (an approved or draft run's own figures, else the estimate).
- **The Summary no longer has the "Still owed" line.** It shows only Penalty & Others and the net. The table row keeps its "still owed in all" note.

**Important for use.** The pay rules are unchanged: **with no recovery limit set (the default), the calculator takes nothing automatically**, so the deduction shows as $0.00 with the reason "no recovery limit is set". The owner sets the limit on the Pay runs page for the deduction to show and apply.

- **Database:** additive columns and an index. Run `...claim-courier-name.sql` (back up first, on a copy first, after the #141 migration). Rollback: `...claim-courier-name.rollback.sql` (matched claims keep their driver; only the stored names are lost). Applied to `nasa_local` only. **Do not run on production yet.**
- **Config and dependencies:** None.
- **Money impact:** which driver a claim is charged to now follows the Courier name, so claims can land on different drivers than the waybill history gave. Nothing is deducted at upload; a claim reaches pay only through a pay run, as before.

**Tested.** Backend (whole suite 0 failures with both database flags; 33 skipped by the other switch): `courierNames.test.js` (the Delivery ID rules, names and IDs, missing columns, only Details of Delivery Fees, understated sheet range); `claimsParser.test.js` (the Courier name is kept, cleaned and keyed; missing or blank gives no name); `weeklyClaimsFlow.test.js` (the real weekly upload with names): matched by name with the bad row reported, duplicates, a changed amount, a claim whose driver is not in the report waits and matches when a later report names the driver, the waybill plays no part, the history-only import no longer matches claims, case and spaces, two Delivery IDs, no NASA driver, wrong city, Offset Details ignored, no name, a claim stored without a name learns it; the hand-entered claim hold, the exempt rule, one pay run taking each claim once, city checks, and the missing-table cases; `assignmentHistoryFlow.test.js` updated; `periodSummary.test.js` (no dates gives the same estimate as the range, and nothing once the rows are on a run). Frontend: every test file passes; `Dashboard.penalty.test.jsx` covers no dates, the single Summary line and no still-owed line; build passes; lint is clean on the changed files.

**Not tested.** With a real weekly report file; by hand in a browser.

**Follow-ups.** A report with no Claims Detail sheet does not re-match earlier open claims. Claims stored before this change have no name and stay as they are.

## Review fixes (Jasil's review of #181, and the client's weekly-only rule, 4 Nov 2026)

- **Client rule (confirmed by the owner and Jasil): imported GOFO carrier claims are deducted only in weekly GOFO pay runs.** Daily SpeedX runs use manual advances and penalties and never consume an imported claim. Manual advances and penalties apply in both. The same rule is in the real pay run (`generateRun` loads carrier claims only for a weekly run) and in the dashboard estimate (a daily run in the estimate gets no claims). The exemption, recovery-limit and instalment rules are unchanged.
- **The driver's name is part of a claim's facts (P1).** Before, same-file conflicts and stored-claim comparisons looked only at the amount and dates, so two rows for one claim under different names charged whichever came first, and a corrected name counted as a duplicate (the old driver stayed charged). Now: in one report, two rows for one claim naming different drivers conflict and neither is imported ("a different driver name"); a repeat that only supplies a missing name keeps it. For a stored claim, a name that differs only by case or spacing is the same fact (still a duplicate); a missing name on either side is no change; a genuinely different name is a new version (the old one is superseded and kept as history, the new one is matched afresh), so the corrected driver is charged and the old driver's earlier deduction is flagged for refund by the existing over-recovery rules.
- **A present Claims Detail sheet with no new rows still matches (P1).** After the same city and access checks, the report's fee names are used to match the city's waiting claims, and the answer says what was matched (`rematched`). If the city cannot be confirmed (an unknown route, two cities, no access) nothing is matched and the answer is as before. An absent sheet is unchanged (still no matching).
- **The no-date estimate uses the span of the driver's own eligible work (P1).** It no longer uses 1970 to today, which made every earlier instalment look like one taken in this period. With no dates, the period is the first to the last day of the driver's closed, unpaid pay rows not on a run (today when there are none), which is what a real run for that work would cover. The once-per-overlapping-period protection is kept.
- **Date-relative tests.** The no-date equality test no longer depends on today's date (the period comes from the pay rows); the new instalment regression builds its dates from the database's current date.
- **Tests.** Parser: conflicting names, case and spacing repeat, a repeat that adds the name. Weekly upload (real handler): conflicting names store nothing; a corrected name is a new version and a case change is a repeat; an empty sheet matches a waiting claim, and does nothing without evidence or with an unconfirmed city. Database: a daily draft never takes a carrier claim and the estimate agrees, then the weekly draft takes it once; a previous-period instalment followed by new work (no dates, the explicit current period and the real draft all give $50 deducted and $50 net) and the overlap protection still holds. Existing pay-run fixtures that deduct carrier claims now use weekly rows and weekly runs. The new tests fail on the previous code (checked). Whole backend suite with both database flags: 0 failures (33 skipped by the other switch); every frontend test file passes.

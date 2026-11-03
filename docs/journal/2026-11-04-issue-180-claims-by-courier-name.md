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

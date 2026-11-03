# Payroll page: Edit, Mark complete and History for each amount a driver owes (issue #166, part 6)

- **Date:** 2026-11-03
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #166 / see the pull request for this branch. **Stacked on part 3** (edit and history API), which sits on part 2 (settlements).
- **Branch:** `feat/payroll-entry-actions` (from `feat/ledger-edit-history`)
- **Type and scope:** feat(frontend)
- **Files touched:**
  - new: `Frontend/src/components/Admin/payroll/EntryManager.jsx`, `EditEntryPanel.jsx`, `SettlePanel.jsx`, `HistoryPanel.jsx`, `formParts.jsx`, test `EntryManager.test.jsx`;
  - changed: `Frontend/src/components/Admin/Payroll.jsx` (one section and the signed-in role);
  - this entry. No reserved files.

**What and why.** On the admin Payroll page, a new **Manage entries** list shows each amount the driver owes (exempt claims and credits are left out). A hand-entered claim reads **Penalty**. Each has three actions, opening under the entry:
- **Edit:** starts from the latest saved version, sends only the fields that changed, and requires a reason. The server voids the original and records the corrected entry as one linked action, so the original stays in the history. An entry already on a pay run, or with a repayment, is refused and the server's message is shown.
- **Mark complete:** the admin picks how it was settled, never a bare checkbox:
  - *Deducted through payroll*: records nothing here; a pay run settles it when finalized.
  - *Repaid outside payroll*: amount (defaults to what is outstanding, can be less), date, payment reference and reason.
  - *Waived by NASA*: amount and reason; enabled for a super admin only.
  Only the amount given clears; the rest stays outstanding.
- **History:** every version with the edit's reason, every repayment, waiver and reversal, and the pay runs that used it. A mistaken settlement is reversed with a reason.

Every form keeps one request ID until it succeeds, so a retry is never saved twice. The server's field errors show under the fields. After any change the page reloads the driver's balances, so the totals update. All checks (city access, amounts, who may waive) are the server's; this page only fills the forms in.

Admin pages are English only, like the rest of the admin area.

- **Database:** None.
- **Config and dependencies:** None.
- **Money impact:** none from this code; it calls the settlement, edit and history API (parts 2 and 3).

**Tested.** `EntryManager.test.jsx` (7): the list and the Penalty label (credits and exempt claims left out, no Mark complete on a settled entry); a partial repayment with the right body and reload; waiver disabled for a city admin and a payroll deduction records nothing; a super admin's waiver without a reference; a server error shown and the retry keeping the request ID; edit starts from the latest version, refuses an empty edit and sends only what changed with the reason; history shows versions, repayment and pay run, and a reversal sends its reason. `Payroll.test.jsx` (6), `Pay.test.jsx`, `PayRuns.test.jsx` pass. Lint is clean on the changed files; `vite build` passes.

**Not tested.** By hand in a browser against the running backend (the local database has the tables but the page was not clicked through); phone width.

**Risks and follow-ups.** The entry list in the balances call does not carry the intended payday, so the edit form reads the history first. An admin sees "admin #id" for who acted; names can follow.

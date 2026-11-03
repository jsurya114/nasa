# Ledger edit that keeps the original, and a history view (issue #166, part 3)

- **Date:** 2026-11-03
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #166 / see the pull request for this branch. **Stacked on part 2** (the settlements PR): it relies on that PR's void check for settled entries, so merge that one first.
- **Branch:** `feat/ledger-edit-history` (from `feat/ledger-settlements`)
- **Type and scope:** feat(payroll), backend
- **Files touched:**
  - new: `Backend/migrations/2026-11-03-issue-166-ledger-edits.sql` and `.rollback.sql`, `Backend/services/payroll/ledger/ledgerEdits.js`, test `Backend/tests/ledgerEdits.test.js`;
  - changed: `ledgerRules.js` (`parseEdit`), `ledgerStore.js` (`LedgerError` can carry field errors; `ENTRY_COLUMNS` exported), `ledgerController.js`, `routes/payrollRoutes.js`;
  - this entry. No reserved files.

**What and why.** Jasil's rule (3 Nov 2026): an admin sees a simple Edit, but the original record must remain and the before and after must be shown.
- **Edit** is one atomic action: the original entry is voided and a corrected entry is recorded, and a permanent link row ties the two together with the reason, the admin and the time. Other versions are never changed.
- **What can change:** amount, dates, repayment arrangement, claim type and waybill, the "paid out" flag and the entry's own reason. The type, driver, city and direction cannot; for those, void and record a new entry. The corrected entry is checked by the same rules as a new one (`parseNewEntry`), including the duplicate-claim and exemption rules.
- **What cannot be edited, by the existing void rules:** an entry already voided, already on a pay run (record a correction instead; a statement is never rewritten), or with a repayment or waiver (reverse that first). A refused edit changes nothing.
- **Retries:** the same request ID and reason returns the first result; anything else is refused (409). The void gets its own ID, made from the edit's, so a retry makes the same one.
- **History:** `GET /admin/payroll/ledger/:entryId/history` returns every version of the entry, oldest first, from any version (each with the edit's reason, admin and time and whether it was later voided), plus the settlements and active pay-run lines. City access is checked on the server.
- `POST /admin/payroll/ledger/:entryId/edit`, admin and super admin; the admin comes from the token.

Not in this part: the Payroll page buttons, per-period amounts and the dashboard row.

- **Database:** additive. `Backend/migrations/2026-11-03-issue-166-ledger-edits.sql` (back up first, test on a copy, safe to run twice) adds `driver_ledger_edits`, which is append-only. The ledger table is untouched. Rollback: `...ledger-edits.rollback.sql` (the voided originals and corrections stay, only the link is lost). Run on `nasa_local` only. **Do not run on production yet.**
- **Config and dependencies:** None.
- **Money impact:** none until an entry is edited. An edit changes what a later pay run recovers only for entries not yet on a run.

**Tested.** `ledgerEdits.test.js` (rules, plus 7 database steps in one rolled-back transaction, made-up data): the edit voids and links with reason and actor; replay and reused ID; a second edit of the original refused, and history in order from any version; bad changes refused with field errors; atomic (original stands when the correction cannot be saved); refused for a repaid entry and an entry on a pay run; wrong city, a void and a missing entry; the link rows cannot be changed or deleted. Whole backend suite: 0 failures.

**Not tested.** The HTTP routes with real tokens; production data.

**Risks and follow-ups.** The page that shows the history and the Edit button come with the Payroll page PR.

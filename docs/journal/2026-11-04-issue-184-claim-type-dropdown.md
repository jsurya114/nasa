# Claim type of a penalty is chosen from a list (issue #184)

- **Date:** 2026-11-04
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #184 / see the pull request for this branch
- **Branch:** `feat/penalty-claim-type-dropdown` (from `develop`)
- **Type and scope:** feat(payroll), frontend
- **Files touched:** `Frontend/src/components/Admin/payroll/{ClaimTypeSelect.jsx, claimTypes.js, LedgerEntryForm.jsx, EditEntryPanel.jsx}`, tests `ClaimTypeSelect.test.jsx` and `Admin/Payroll.test.jsx`; this entry. No reserved files.

**What and why.** On the Payroll page, when the record type is Penalty, the Claim type field was free text. It is now a drop-down: Fake pod, Lost, Tracking interruption, Damaged item. A choice is required before the record can be added (the server already refused an empty claim type). "Tracking interruption" keeps the carrier's spelling because the server's Dallas GOFO exemption reads it.

- The Edit panel for a penalty uses the same drop-down. If an older entry holds another spelling (for example text typed before this change), that value stays in the list, so opening it shows no blank and the edit does not change it silently.
- The refund form (correcting a carrier claim) is unchanged: it names a claim that came from the carrier's file, which can have any type.
- Server rules are unchanged: claim types are still compared ignoring case and spaces.

- **Database:** None. **Config and dependencies:** None. **Money impact:** None.

**Tested.** Payroll page tests: the four options after a prompt, an advance has no claim type, saving without a choice shows "Choose the claim type" and sends nothing, the chosen value is posted; the older spelling stays selectable. All Admin frontend tests pass (7 files, 66 tests); lint is clean on the touched files; `vite build` succeeds.

**Not tested.** By hand in the browser. The wider lint run reports 11 errors in other Admin files; the same 11 are on `develop` without this change.

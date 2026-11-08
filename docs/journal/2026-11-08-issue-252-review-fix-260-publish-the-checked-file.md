# Review fix for PR #260: Publish sends the file that was checked

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR #260; branch `feat/gofo-insights-ui`
- Type and scope: fix, `Frontend/src/components/Admin/statements/StatementUpload.jsx`, `StatementList.jsx` and the page test. No reserved file.

## What and why

Jasil's review found that Publish could send a different workbook from the one the preview described: check file A, choose file B while A's check was pending, let A's answer
arrive, and the screen showed A's preview while Publish uploaded B, which the server could accept as a valid new statement or correction.

- The preview is now bound to the exact `File` that was checked. Choosing another file drops the preview at once, and any answer still on its way for an older request is ignored.
- Publish sends the checked file itself (not whatever is selected now) and is offered only while that file is still the chosen one.
- The file input is disabled while a request is running, so the file cannot change mid-request in normal use.
- A statement that was published is always followed by a refresh of the list, even if the screen state has moved on.
- The list also states plainly when a replaced version's NASA-side figures are not available (the backend change is in #259), instead of showing a number.

## Database, config, dependencies

None.

## Money impact

None. This changes which file the owner is shown and sends, not any calculation.

## Tested

- `Frontend/src/components/Admin/CarrierStatements.test.jsx` (11 tests): your sequence, written as a component test with a held-back check for file A. A's late answer shows no preview and
  no Publish button, and after checking B the Publish request carries `b.xlsx`; choosing another file removes an existing preview and Publish; a replaced version shows "Not available" and the reason, not zero.
  The first test fails against the previous component. Whole frontend suite: 490 pass. Build passes. The files I touched pass lint; the repository's other 14 lint errors are the same on a clean `develop`.

Not tested: a real browser with a slow network and a real second file, and a file edited on disk between the check and Publish (the browser refuses to read a changed file).

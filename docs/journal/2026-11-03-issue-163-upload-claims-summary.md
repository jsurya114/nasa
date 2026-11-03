# Show the claims and history summary on the upload screen (issue #163)

| Field | Value |
|---|---|
| Date | 2026-11-03 |
| Author | Jasil (with Claude Code) |
| Issue / PR | `#163` / see the pull request for this branch |
| Branch | `feat/upload-claims-summary` |
| Type / scope | `feat(frontend)` |
| Files touched | New: `Frontend/src/components/Admin/UploadResultSummary.jsx` and its test. Edited: `Frontend/src/redux/slice/admin/excelSlice.js` (keeps the answer's `data` as `weekly.result`), `Frontend/src/components/Admin/DoubleStop.jsx` (renders the summary under the weekly form). |
| Reserved files touched | Upload screens (Jasil). |

**What and why.** Since #160 the weekly upload answers with a `claims` summary and, since #157, an `assignmentHistory` summary. The upload screen kept only the message, so an admin could not see that claims were rejected, waiting for history, or not stored because the city was unclear. A new panel under the weekly form now shows, in plain English (admin screen):

- **Claims stored:** how many were read, new, already recorded, changed amount (new version), matched to a driver (to charge / exempt with no deduction), waiting for history, unclear driver or city, held for review (already entered by hand), and the note that nothing is deducted until a pay run that includes the claim is finalized.
- **Bad rows:** Excel row number and reason; if the server sent only the first 20, it says so.
- **Not stored:** the server's reason in full (unknown route, more than one city, no access, tables not set up), the number of claims in the file, and that the pay upload was not affected. Shown as an alert.
- **No Claims Detail sheet:** says so and nothing else.
- **City admin vs super admin:** the screen shows only what the server sends. `notStored` (claims that already belong to another city) is shown only if present, so only a super admin sees it, as in #160.
- **Carrier history:** one line (new records, already known, rows without a usable waybill or Delivery ID, rows left out), or that it was not saved and why.
- The panel is empty before an upload, is cleared when a new upload starts, and shows nothing for a failed upload (the existing error toast stays).

**Session boundary (review round 1, Jayasoorya).** The weekly answer is role- and city-scoped (a city admin does not get `notStored`), so it must not be shown outside the session that received it. Three rules in `excelSlice.js`:

1. The result carries its owner (`ownerAdminId`, the signed-in administrator when the upload started) and is only read through `selectWeeklyResult`, which returns it only while that same administrator is signed in. The panel uses that selector, so a result is never shown to anyone else even if a boundary below were missed.
2. The result and the request in flight are cleared when the session ends or changes: sign-out (at its start, whatever its outcome), the client-side sign-out, signing in, and the server ending the session (an access check that fails for any reason other than a lost connection). A lost connection that only delays the access check keeps the result.
3. Only the answer to the latest upload request is accepted (`activeRequestId`). An answer that arrives after the session ended or changed, or after a newer upload began, is dropped, so an upload in flight cannot repopulate the result for the next session.

**Money impact.** None. Display only.

**Tested.** 10 component tests and 6 session-boundary tests (real slices and thunks, fake server, made-up administrators: result shown only to its owner; cleared by both sign-out paths and by the next sign-in; cleared when the server ends the session; kept through a lost connection; a late answer after sign-out and the next sign-in is dropped; a late answer to an older upload is dropped). Component tests: stored claims, waiting for history, bad rows, "first 20" notice, not stored for an unknown route and for two cities, no claims sheet, `notStored` and held shown only when sent, history not saved, nothing before an upload, and the slice keeping and clearing the answer. Removing the session reset, the stale-answer guard or the owner check each fails the session tests. Whole frontend suite: 146 passed. Production build passes.

**Not tested.** The panel inside the full `DoubleStop` page with a real upload (the page needs the whole admin shell); in a browser or phone.

**Note on running tests locally.** Frontend tests need a recent Node (jsdom's `undici` needs zstd support); on Node 25 or newer, run them with `NODE_OPTIONS=--no-experimental-webstorage` because the built-in `localStorage` breaks `fakeShell`. CI uses `.nvmrc`.

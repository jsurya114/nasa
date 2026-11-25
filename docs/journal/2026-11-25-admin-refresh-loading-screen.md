# Admin page: show "Loading" instead of a blank page while the sign-in check runs

| Field | Value |
|---|---|
| Date | 2026-11-25 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (not opened yet: Jasil to say OK first) |
| Branch | `fix/admin-refresh-loading` (from `develop`) |
| Type / scope | `fix(auth)` |
| Files touched | `Frontend/src/routes/admin/ProtectedRoute.jsx`, `Frontend/src/routes/admin/ProtectedRoute.test.jsx` (new), this entry. |
| Reserved files touched | None on the reserved list. This is Jasil's sign-in code, so he is asked first. |

**What and why.** An admin who refreshed a page (for example `/admin/double-stop`) while the DFW weekly upload was processing saw a blank page. On refresh the page asks the server "is this admin signed in?". While waiting, `ProtectedRoute` returned nothing. During a big upload the server is busy and answers late (measured on a laptop with the DFW file: the server froze up to 1.8 s at a time with the current code), so the empty screen lasted long enough to look broken. It now shows the same page-shaped "Loading, please wait..." as other screens, while the check runs and while the sign-in state is still unknown. Nothing else changes: signed in opens the page, signed out goes to login, a failed check still shows "Try again".

**This does not make the server faster.** It only removes the blank screen. The upload still keeps the server busy (see `2026-11-25-weekly-upload-read-once.md` and the upload worker on Jasil's list).

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** Three new tests (Loading while the check runs, Loading while the state is unknown, signed in opens the page and signed out goes to login); the first two fail on the old code and pass now. Whole frontend suite 637 passed, `npm run build` ok. **Not tested:** on production with a real session during a real upload (needs a deploy); the cause is from the code and a laptop measurement, not yet from the server.

**Risks and follow-ups.** The `loading` flag is shared by the sign-in check only for this route, so a screen already open does not flash Loading unless the check runs again. Frontend deploys from `main` through Vercel, so it goes live after the next release to `main`.

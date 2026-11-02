# Weak connections, step 1: keep what was typed and check an unconfirmed save (journey form)

| Field | Value |
|---|---|
| Date | 2026-11-02 |
| Author | Jasil (with Claude Code) |
| Issue / PR | `#22` / see the pull request for this branch |
| Branch | `feat/mobile-weak-connection` (built on `feat/mobile-file-pickers` and the stack below it) |
| Type / scope | `feat(frontend)` |
| Files touched | New: `Frontend/src/utils/formDrafts.js`, `hooks/useFormDraft.js`, `hooks/useUncertainSave.js`, `components/Drivers/UncertainSaveNotice.jsx`, tests `utils/formDrafts.test.js` and `components/Drivers/Journey.test.jsx`. Edited: `components/Drivers/Journey.jsx`, `redux/slice/driver/journeySlice.js` (one flag on a failed save), `native/sessionStore.js` (clear drafts at sign-out), `hooks/translation.js` (five strings, English and Spanish), `docs/MOBILE_APP_DESIGN.md` (status of section 6) |
| Reserved files touched | None of the Excel, pay and dashboard zone. `Journey.jsx` and `journeySlice.js` are Jayasoorya's zone (driver screens); the change is small and about save feedback only, and is part of the mobile work in issue #22. |

**What and why.** Section 6 of `docs/MOBILE_APP_DESIGN.md`: the app must work on weak connections without losing what was typed and without lying about whether something was saved. Done for the driver's journey form, the daily write.
- **Drafts.** The route and sequence numbers a driver types are kept in `sessionStorage` (private to the tab or WebView, never shared), keyed by area and driver. They are restored after a reload or a WebView restart, removed when the journey is saved, and all of an area's drafts are removed at sign-out. A different driver signing in on the same phone sees an empty form. Only short plain-text values are kept.
- **Uncertain save.** Before, a failed request showed a "Network Error" message although the server might have saved the journey, and a second tap then ran into "already saved". Now a request that gets **no answer at all** (the connection dropped) is flagged by the slice; the page asks the server for today's journey and then shows one of three things: **saved** (the usual success, with the request sent only once), **"It was not saved. What you typed is still here. Please submit again."** (submit works again), or **"We could not confirm this was saved"** with Check again, while Save stays switched off so the same journey cannot be sent twice. It checks again by itself when the connection returns. A real refusal from the server (a 400 with a message) is unchanged.
- **Success is only shown after the server confirms.** A failed refresh of the journey list *after* a confirmed save used to turn the success into a failure message; it no longer does.
- **`Idempotency-Key` is not built, and is not needed for now.** Checked in the code: a second journey for the same driver and day is already refused (`journey.alreadySaved`, a 400 before the insert) and a second access code with the same code is already refused (`accessCode.alreadyExists`, a 409). A repeated request cannot create a duplicate, so the missing piece was the page's behaviour, not the backend. Recorded in the design document.

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None. The journey data sent to the server is unchanged.

**Tested.**
- `npm test` in `Frontend/`: 75 of 75 pass (60 before, 15 new). 5 for the draft storage (per area, person and form; blanks are not stored; hostile or oversized stored values are cleaned; clearing one draft or one area touches nothing else; no error when storage is blocked). 10 with the real journey form, slices and sign-out and a fake server that can drop the connection: a normal save; a failed list refresh after a confirmed save; a drop after the server saved (shown as saved, request sent once); a drop before it saved (entries kept, second submit works, two requests in all); the server unreachable for the check (Save stays off, a click sends nothing, then it settles by itself on the `online` event); Check again by hand; a real 400 refusal is not treated as uncertain; restore after a reload and removal once saved; another driver sees an empty form; sign-out removes the drafts.
- Mutation checks: ignoring the flag, not blocking submit while unconfirmed, not clearing drafts at sign-out, and the slice not flagging each make tests fail.
- `eslint` clean on the files touched; `vite build` succeeds.
- **Not tested:** on a phone, or with a real weak connection (only a simulated drop, answered or not). The `online` event in the real WebViews. The look of the notice on a small screen.

**Not built, and why.** The same handling for the access-code and agreement forms (the access-code form is 736 lines with images that cannot be restored, and needs its own change), and the read-only cache with a freshness label, which depends on a decision of Jasil's about which screens may show old data. Both are described in the design document.

**Risks and follow-ups.** The check relies on "today's journey exists" meaning "this save worked", which is true because only one journey per driver and day is allowed. If that rule ever changes, the check must compare the saved values.

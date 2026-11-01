# Escape stored values in the access code delete dialog (issue #15, found while fixing sanitizing)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #15 / see the pull request for this branch
- **Branch:** `fix/escape-access-code-dialog`
- **Type and scope:** fix(access-codes)
- **Files touched:** `Frontend/src/components/Admin/AccessCode.jsx`. No reserved files.

**What and why.** The "Delete Access Code?" dialog on the admin access code page is built as HTML, and it put the stored address, zip code and access code into that HTML as they were. Drivers can create access codes too (`POST /driver/access-codes`), so the text is not always typed by an admin, and it was shown to an admin as live HTML. The server-side cleaning of input (issue #15) is only a safety net and cannot catch every form of HTML. The values are now escaped (`& < > " ' \``) before they go into the dialog, so they are always shown as plain text. This was the only place in the frontend that builds HTML from data; there is no `innerHTML` or `dangerouslySetInnerHTML` anywhere else, and the rest of the screens are rendered by React, which escapes text.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** The escape function was run on an ordinary address (unchanged), a name with an apostrophe and `&`, an image tag with a handler, a quote-closing script payload, a backtick, null, undefined and a number: nothing with `<`, `>` or quotes is left, ordinary text reads the same. `npm run build` succeeds. ESLint on the file reports only the 3 errors and 1 warning that were already there (belong to issue #40). Not tested: the dialog in a browser (it needs a running backend and an access code with hostile text). A reviewer should create an access code whose address is `<img src=x onerror=alert(1)>`, press delete, and see the text, not an alert.

**Risks and follow-ups.** The text now appears exactly as stored, including any `&amp;` the user typed. Codes already in the database that contain HTML are not changed.

# Fix request sanitizing under Express 5 (issue #15)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #15 / see the pull request for this branch
- **Branch:** `fix/sanitize-query-params`
- **Type and scope:** fix(validation)
- **Files touched:** `Backend/middlewares/sanitize.js`, `Backend/routes/adminRoutes.js` and `Backend/routes/driverRoutes.js` (one line each to register the URL parameter cleaning). No reserved files.

**What and why.** The global sanitizer was meant to clean the body, the query string and the URL parameters. Checked on the real middleware under Express 5:
- **Query string: not cleaned at all.** Express 5 rebuilds `req.query` on every read, so assigning into it had no effect. The cleaned copy is now set on the request as its own property, which later reads return.
- **URL parameters: not cleaned at all.** The sanitizer runs before any route matches, when the parameters do not exist yet. Each router now cleans them once its route has matched (`sanitizeRouterParams`), for the names the routes use: `id`, `driverId`, `driver_id`, `journey_id`.
- **Body: cleaned, but with a flaw.** It removed the closing `</script>` before the block pattern could match, so the script text stayed (`<script>alert(1)...`). It also cost a lot of time on crafted input: a few hundred KB of repeated `<script ` took seconds (before login, with a 50 MB body limit).
- **Real text was damaged.** The "on...=" and "javascript:" rules ran on all text: `online=yes` became empty and "See javascript: docs" lost a word.
- **New approach: do not read HTML at all.** Two rounds of automated security review showed that any code that imitates how a browser reads a tag (regular expressions, then a one-pass scanner) can be bypassed by quotes, `/`, a second `<` or odd attribute names. The sanitizer now removes every `<` that is followed by a letter, `/`, `!` or `?`, because a browser cannot start a tag or a comment without that. A run of `<` goes together, so `<<img` cannot leave `<img`. Whatever else is in the text is left as it is (`img src=x onerror=...>` becomes inert text). Nothing is left to bypass, and it is one pass over the text. A value that starts with `javascript:` (a link) loses that prefix.
- **Kept as is:** ordinary text, addresses, `&`, quotes, `=`, accents, a `<` or `>` in a sentence (`2 < 4`), surrounding-space trimming.
- **Passwords keep their old cleaning, exactly, at any length (review fixes from Jasil).** Before this change every password was cleaned by the old rules before it was hashed or compared, so some stored hashes stand for the cleaned text (a password typed with `onclick=x` was stored without it; one with an HTML comment or script block was stored without it, however long). Cleaning passwords differently now would reject those people. `password`, `oldPassword`, `newPassword` and `confirmPassword` therefore give the same result as the old rules for every input. The old rules were regular expressions that a crafted input could make very slow (seconds for a few hundred KB, before login), so `legacyCredentialClean` re-implements them as passes that read the text once, on the **whole** string. (A first version cleaned only the first 2000 characters; the review showed that changes the meaning of credentials where a comment or block opens before character 2000 and closes after it. That cut is gone.) `refreshToken` and `previousRefreshToken` are only trimmed (a token cannot contain the old rules' patterns).
- Unchanged on purpose: surrounding spaces are still trimmed, numbers, booleans and null pass through, prototype pollution keys are still dropped, and the body size guard stays. SQL safety does not depend on this cleaning (queries use parameters, issue #7).

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** Throwaway scripts (not committed), real middleware under Express 5:
- **Property test:** 300,000 random strings built from a hostile alphabet (`< > " ' ` + `/ = ! ? - &`, letters and a null character) never keep a `<` followed by a letter, `/`, `!` or `?`. 21 crafted payloads do not either, including both reported by the review (`<a <1 onerror=x>` and `<img 'x="y'>" src=x onerror=...>`), nested rebuilds, null characters, comments, upper case and tab or line break tricks.
- **Speed:** 5 million `<`, a million repeats of `<a `, `"<`, `<< ` and `<script>`, and 20 MB of plain text are each cleaned in under 100 ms.
- Body, nested values, the query string, repeated query keys and URL parameters are all cleaned; two URL parameters in one route; no body, empty body, numbers, booleans, null, arrays and prototype-pollution keys behave as before; a check reads the real route files and confirms every `:param` name is in the cleaned list.
- Real text (addresses, accents, apostrophes, `&`, `=`, `online=yes`, "javascript: docs", `2 < 4`, lone `<`) comes back unchanged. Passwords are cleaned exactly as before (see above); tokens are only trimmed.
- The old code, for contrast: query and URL parameter were not cleaned; the body kept the script text.
- Integration on a temporary Postgres: the real admin routes behind the global sanitizer; an evil search value and URL parameter reach the handlers without a tag start (a hostile id returns no data), and a plain id still works. The earlier city and availability suites still pass.
Not tested: the screens in a browser, the production server.

**Risks and follow-ups.**
- **Real text that has a `<` right before a letter loses that `<`** (for example "a<b" becomes "ab", and "<rear entrance>" becomes "rear entrance>"). Addresses and names almost never contain one. This is the price of not having to read HTML; it is the only text this change alters.
- **This is a safety net, not the main protection.** The screens must still escape what they show and queries use parameters. One screen did not: the delete dialog on the access code page built HTML from stored values; that is fixed in its own pull request (drivers can create access codes too). Output inside an HTML attribute needs its own quote escaping wherever it is built by hand.
- A new route with a URL parameter name that is not in `PARAM_NAMES` is not cleaned. Add the name to the list in `sanitize.js`.
- Values that were stored before this change are not rewritten.
- `multipart` forms (access code uploads) are cleaned by the same body rule after the upload middleware runs, as before.

**Credential compatibility tests (review fixes).**
- **Differential test against the original expressions:** about 5.9 million random strings built from every token the old rules care about (`<script`, `</style>`, `<!--`, `-->`, `onclick=`, `on=`, quotes, `javascript:` in any case, odd whitespace such as a non-breaking space, `ſ` and the Kelvin sign for case folding, pieces that rebuild a closer such as `</scr</script>ipt>`), from 1 to 1200 tokens long (some well past 2000 characters): the new code returned exactly what the old expressions return, every time. Hand-picked boundary cases (a comment, script block, iframe or quoted handler crossing character 2000, a handler at the very end, a 3000-letter word) are identical too.
- **Speed:** half a million repeats of `<script `, `<style>`, `<!-- `, ` onx="`, ` onx=1`, `<iframe >`, `javascript: `, a 4 MB run of `on`, and 20 MB of plain text are each cleaned in under a second (most in about 100 ms). The old expressions took seconds for a few hundred KB.
- **Old accounts, new login (real handlers, real bcrypt, temporary Postgres):** with the old sanitizer from `develop`, the new one, the real driver and admin create, login and change-password handlers: 19 typed passwords, including ones the old rules rewrote and six that cross the old 2000-character line, are created under the old code and sign in under the new code for both driver and admin, as on `develop`. One (`online=yes12`) is blanked entirely by the old rules, so no account could ever be created with it; identical now. A wrong password is still refused; password changes work in both directions; a 2.4 MB hostile password is answered in under 100 ms.

**Follow-up (separate piece of work).** To clean passwords like other text, add a migration: accept a login if the plain or the old-cleaned text matches, then re-hash with the new rule and stop using the old one. Not done here because it changes how credentials are verified.

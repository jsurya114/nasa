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
- **Passwords and tokens are not altered.** `password`, `oldPassword`, `newPassword`, `confirmPassword`, `refreshToken` and `previousRefreshToken` are only trimmed, as before, because they are never shown as HTML and a person may already have a `<` in their password (changing it would lock them out).
- Unchanged on purpose: surrounding spaces are still trimmed, numbers, booleans and null pass through, prototype pollution keys are still dropped, and the body size guard stays. SQL safety does not depend on this cleaning (queries use parameters, issue #7).

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** Throwaway scripts (not committed), real middleware under Express 5:
- **Property test:** 300,000 random strings built from a hostile alphabet (`< > " ' ` + `/ = ! ? - &`, letters and a null character) never keep a `<` followed by a letter, `/`, `!` or `?`. 21 crafted payloads do not either, including both reported by the review (`<a <1 onerror=x>` and `<img 'x="y'>" src=x onerror=...>`), nested rebuilds, null characters, comments, upper case and tab or line break tricks.
- **Speed:** 5 million `<`, a million repeats of `<a `, `"<`, `<< ` and `<script>`, and 20 MB of plain text are each cleaned in under 100 ms.
- Body, nested values, the query string, repeated query keys and URL parameters are all cleaned; two URL parameters in one route; no body, empty body, numbers, booleans, null, arrays and prototype-pollution keys behave as before; a check reads the real route files and confirms every `:param` name is in the cleaned list.
- Real text (addresses, accents, apostrophes, `&`, `=`, `online=yes`, "javascript: docs", `2 < 4`, lone `<`) comes back unchanged. Passwords and tokens keep their `<` and are only trimmed.
- The old code, for contrast: query and URL parameter were not cleaned; the body kept the script text.
- Integration on a temporary Postgres: the real admin routes behind the global sanitizer; an evil search value and URL parameter reach the handlers without a tag start (a hostile id returns no data), and a plain id still works. The earlier city and availability suites still pass.
Not tested: the screens in a browser, the production server.

**Risks and follow-ups.**
- **Real text that has a `<` right before a letter loses that `<`** (for example "a<b" becomes "ab", and "<rear entrance>" becomes "rear entrance>"). Addresses and names almost never contain one. This is the price of not having to read HTML; it is the only text this change alters.
- **This is a safety net, not the main protection.** The screens must still escape what they show and queries use parameters. One screen did not: the delete dialog on the access code page built HTML from stored values; that is fixed in its own pull request (drivers can create access codes too). Output inside an HTML attribute needs its own quote escaping wherever it is built by hand.
- A new route with a URL parameter name that is not in `PARAM_NAMES` is not cleaned. Add the name to the list in `sanitize.js`.
- Values that were stored before this change are not rewritten.
- `multipart` forms (access code uploads) are cleaned by the same body rule after the upload middleware runs, as before.

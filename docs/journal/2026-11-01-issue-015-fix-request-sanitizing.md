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
- **Body: cleaned, but badly.** It removed the closing `</script>` before the block pattern could match, so the script text stayed (`<script>alert(1)...`). Blocks are now removed first, repeatedly, so nested tricks such as `<scr<script></script>ipt>` cannot rebuild a tag.
- **Real text was damaged.** The "on...=" and "javascript:" rules ran on all text: `online=yes` became empty and "See javascript: docs" lost a word. They now apply only inside an HTML tag, or when a whole value starts with `javascript:`. Ordinary text, addresses, `&`, `<` and `>` in sentences, accents and harmless HTML such as `<b>` are kept.
- Unchanged on purpose: surrounding spaces are still trimmed, numbers, booleans and null pass through, prototype pollution keys are still dropped, and the body size guard stays. SQL safety does not depend on this cleaning (queries use parameters, issue #7).

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** Throwaway scripts (not committed), real middleware under Express 5:
- Ten active-HTML payloads (script, style, iframe, svg handlers, javascript: links, comments, nested rebuilds) are removed from the body, nested body values, the query string, repeated query keys and URL parameters.
- Fifteen real texts (addresses, names with accents and apostrophes, `&`, `=`, `<rear entrance>`, "online=yes", "javascript: docs", a password with symbols) come back unchanged in body and query.
- Two parameters in one route are both handled; no body, empty body, numbers, booleans, null, arrays and prototype keys behave as before.
- Every `:name` used in the real route files is in the cleaned list (the check reads the files).
- The old code, for contrast: query and URL parameter not cleaned, body keeps the script text.
- Integration: the real admin routes behind the global sanitizer on a temporary Postgres: a search value with a script tag is cleaned and still finds the right city; a URL parameter `1<script>x</script>` reaches the handler as `1`. The earlier city and availability suites still pass.
Not tested: the screens in a browser, the production server.

**Risks and follow-ups.**
- A new route with a URL parameter name that is not in `PARAM_NAMES` is not cleaned. Add the name to the list in `sanitize.js` (the check script reads the route files; there is no automated test in the repository yet).
- Values that were cleaned before may now come out slightly different: text with "on...=" or "javascript:" outside a tag is no longer stripped. That text was being damaged, so this is intended. Passwords are cleaned like any other value, as before; a password that contains an HTML tag with an event handler would still be altered.
- `multipart` forms (access code uploads) are cleaned by the same body rule after the upload middleware runs, as before; not changed here.

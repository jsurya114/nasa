# One wrapper instead of repeated try/catch, part 1: the wrapper and the route controller (issue #20)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #20 / see the pull request for this branch
- **Branch:** `refactor/async-handler-routes`
- **Type and scope:** refactor(routes)
- **Files touched:** `Backend/utils/asyncHandler.js` (new), `Backend/controllers/admin/routeController.js`. No reserved files.

**What and why.** Every handler repeated the same shape: `try { ... } catch (err) { log it; send an error answer }`. `asyncHandler(handler, { log, respond })` does the try, the log and the hand-over once:
- it runs the handler and, if the handler throws or rejects, logs `log` with the error and calls `respond(error, req, res)`;
- `respond` is the answer that handler's own catch block used to send, copied as it was (status code and JSON), so every answer stays exactly the same; different handlers keep their different answers (500 with `error`, 500 with `success:false`, 400 for a failed update, and so on);
- without `respond`, the error goes to the shared error handler through `next(error)` (for new code).

The route controller's nine handlers were converted this way. The body of each handler is unchanged except that it is one level less indented (review with "hide whitespace": `?w=1`). The log messages are the same as before.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** Throwaway scripts (not committed):
- Wrapper unit checks (7): the handler's answer is sent untouched; a throw, a rejected promise and a synchronous throw are all caught; `respond` answers and `next` is not called; without `respond` the error goes to `next`; the error is logged once with the given message; `req`, `res` and `next` are passed on.
- The old route controller (from `develop`) and the new one called side by side: (a) with the database failing, each of the nine handlers as an admin and as a superadmin gave the identical status and body (18 comparisons); (b) on a seeded Postgres, 27 requests (create with a good body, empty name, bad price and unknown city; both list forms; dropdowns; read, update, toggle and delete with own-city, other-city, missing and non-numeric ids; routes of a driver in own and other city and with no id) gave identical statuses and bodies, and the stored routes were identical afterwards. 46 checks, all passed. Not tested: the screens.

**Risks and follow-ups.** None known. The other controllers follow as their own pull requests (they build on this wrapper). The Excel, pay, dashboard and analytics controllers are Jasil's.

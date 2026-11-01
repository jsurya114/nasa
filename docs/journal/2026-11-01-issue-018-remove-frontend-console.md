# One small logger, part 5: remove the frontend console calls (issue #18)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #18 / see the pull request for this branch
- **Branch:** `refactor/remove-frontend-console`
- **Type and scope:** refactor(frontend)
- **Files touched:** 20 files under `Frontend/src`: the route, job, user, journey, delivery, password and driver slices, `axiosInstance.js`, the inactivity and translation hooks, the login, journey, jobs, users, delivery and password screens, and the driver and admin lists. **Not touched (Jasil's zone):** `RouteDoubleStopAnalyzer.jsx`, `DoubleStop.jsx` and `dashboardUpdateSlice.js` (4 calls remain there).

**What and why.** The engineering standard says "No `console.log` left in committed frontend code", and issue #18 says to remove the frontend ones. 83 `console.log`, `console.warn` and `console.error` calls are removed. They printed things like the routes returned by the server, the data typed into the city form, the added driver or admin that came back from the server, and the detected timezone, in every visitor's browser console. The browser has no server log to send them to, and every screen already shows its own errors (toast or store error), so the calls are simply removed.

Removing a log can leave an empty block or an unused variable, so the code around each one was tidied, with no change in what happens:
- The five route thunks wrapped their request in `try { ... } catch (error) { throw error }` only to log. The wrapper is removed; the error is still thrown the same way (checked: success gives "fulfilled", a failing request gives "rejected" with the error message).
- `try { dispatch(toggleAvailUser(id)) } catch {}` in the driver and admin lists cannot catch anything (dispatching a thunk does not throw), so it is now just the dispatch.
- The empty `if (rejected)` block after the password update is gone; the errors are still shown by the effect that reads them.
- Catch blocks whose error variable is no longer used now use `catch {`; the two `.catch` handlers in the users screen keep an empty handler with a comment so a failed edit is not reported as an unhandled promise.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.**
- ESLint on the 20 files: 23 findings before and 23 after, none new (the existing ones belong to issue #40). This is how the tidy-up was driven: the first pass of removal added 15 findings (empty blocks, unused variables, useless try/catch) and they were fixed.
- `npm run build` succeeds.
- A throwaway script with a stub for the request library ran each of the five route thunks: success resolves, a failing request rejects with the same error.
- Searched: the only `console` calls left in `Frontend/src` are the 4 in Jasil's files.
- Not tested: the screens in a browser.

**Risks and follow-ups.** A developer debugging in the browser no longer sees these messages. That is the aim. For the file-by-file view of failures there is the network tab and the toasts the screens already show.

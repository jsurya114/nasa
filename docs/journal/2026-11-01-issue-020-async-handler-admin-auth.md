# One wrapper instead of repeated try/catch, part 3: admin sign-in handlers (issue #20)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #20 / see the pull request for this branch
- **Branch:** `refactor/async-handler-admin-auth`
- **Type and scope:** refactor(auth)
- **Files touched:** `Backend/controllers/admin/adminController.js`. No reserved files.
- **Builds on:** part 1, which adds `Backend/utils/asyncHandler.js`. Until it is merged this pull request also shows that commit.

**What and why.** The admin sign-in (`Login`), the current-admin (`getUser`) and the token refresh (`RefreshToken`) handlers now use `asyncHandler`, with the answer each catch block sent copied as it was (500, 500 and 401). Bodies are unchanged apart from one less indent level (review with `?w=1`). The login handler's rate limit, the token rules and the answers for a wrong password, an unknown email and a blocked account are untouched.

`Logout` was left as it is on purpose: it does work before its `try`, and moving that inside the wrapper could change the answer in an edge case.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** A throwaway script (not committed) called the old controller (from `develop`) and the new one side by side with real bcrypt hashes and a real Postgres and Redis: (a) with the database failing, 14 requests (right and wrong sign-in, unknown email, blocked account, no fields, no body, current admin found, missing and no user, valid, bad and missing refresh tokens) returned identical status and body; (b) the same 14 requests on a seeded database returned identical status and body (tokens and the password hash masked since they differ every time). 28 checks, all passed. Not tested: the screens.

**Risks and follow-ups.** None known.

**What was left out of issue #20 on purpose.** The remaining handlers outside Jasil's zone were not converted because moving them would change an answer in an edge case: they do work before their `try` (reading the language or the body), or their catch block has more than one branch or its own logging (`addAdminController`, `addUserController`, the access code controllers, the driver controllers, `Logout`). The controllers changed by the open pull requests #72 to #77 are left until those merge. They can be converted one by one, each with its answers checked, when someone decides the small gain is worth the risk.

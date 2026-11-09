# Lint clean-up, part 5: hooks and routes (issue #40)

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #40 / see the pull request for this branch
- **Branch:** `chore/lint-hooks-and-routes`
- **Type and scope:** chore(frontend)
- **Files touched:** `Frontend/src/hooks/translation.js`, `Frontend/src/hooks/useInactivityLogout.js`, `Frontend/src/routes/admin/PublicRoutes.jsx`, `Frontend/src/routes/driver/DPublicRoutes.jsx`. No reserved files.

**What and why.** Fixes the 8 remaining lint findings in these two folders, with no behaviour change.
- **`translation.js`, duplicate keys (2):** the key `view` was written twice in the English texts and twice in the Spanish texts, with the same value both times (`'View'` and `'Ver'`). In a JavaScript object the later one wins, so removing the second copy in each language changes nothing the person sees.
- **`useInactivityLogout.js`, hook dependencies (1):** the effect uses two helper functions that are re-created on every render and read the two sign-in flags that are already listed. Adding the helpers as dependencies would restart the effect on every render, re-register the activity listeners and keep resetting the logout timer, so the logout would never fire. The dependencies stay; a comment explains why and a one-line `eslint-disable` marks it.
- **`DPublicRoutes.jsx`, hook dependencies (1):** the effect that checks the driver's sign-in on load lists no dependencies. `dispatch` never changes, so adding it is safe; the effect still runs once.
- **`PublicRoutes.jsx` (4):** unused imports and an unused `dispatch` removed, together with a block of commented-out code that referred to them. The route behaves the same (signed-in admins go to the dashboard, others see the page).

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** `npx eslint src/hooks src/routes`: 0 findings. `npm run build` succeeds. The whole diff was read. Not tested: the inactivity logout in a browser (it takes 5 or 24 hours to fire); the reasoning above is why its dependencies were left alone.

**Risks and follow-ups.** None. After this, the only lint findings left are in Jasil's files.

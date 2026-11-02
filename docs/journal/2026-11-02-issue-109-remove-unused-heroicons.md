# Remove the unused @heroicons/react dependency (follow-up to #109)

- **Date:** 2026-11-02
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #109 (latency) / see the pull request for this branch
- **Branch:** `chore/remove-unused-heroicons` (from `develop`)
- **Type and scope:** chore(deps)
- **Files touched:** `Frontend/package.json`, `Frontend/package-lock.json`. No code files, no reserved files.

**What and why.** Nothing in the frontend imports `@heroicons/react` (the app uses `lucide-react`). Removing it makes installs smaller and leaves one less package to keep patched. It was never in the built bundle, so page speed does not change.

**Database.** None.

**Config and dependencies.** Removes `@heroicons/react`. Rollback: `npm install @heroicons/react@^2.2.0`.

**Money impact.** None.

**Tested.** Searched `Frontend` (code, CSS, HTML, config) for `heroicons`: no references. `npx vite build` succeeds. Not tested: other packages were not audited here (`react-icons` and `sweetalert2` are each used by one or two files, so they stay).

**Risks and follow-ups.** None expected.

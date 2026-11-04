# Remove the node_modules link that was committed by mistake (issue #203)

- **Date:** 2026-11-04
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #203 / see the pull request for this branch
- **Branch:** `fix/remove-node-modules-link` (from `develop`)
- **Type and scope:** fix, repository hygiene
- **Files touched:** `Backend/node_modules` (removed: it was a symlink), `Backend/.gitignore`; this entry. No application code.

**What happened.** While reviewing #202 a temporary symlink `Backend/node_modules` (to reuse installed packages in a review checkout) was left in the working tree. A `git add -A` on the #202 branch picked it up, because the backend ignore rule `node_modules/` matches a folder but not a link with that name. It was squash-merged with #202 (commit 8783dabf). Anyone who pulls `develop` has their real, ignored `Backend/node_modules` folder replaced by that link, so the backend cannot find its packages until they run `npm ci` in `Backend/`.

**Impact.** Local environments only: no code, no data, no secret. The link points at a path on one developer's computer (`.env` is ignored and was not added). Nothing runs differently in CI, which installs its own packages.

**The fix.** `git rm --cached Backend/node_modules` removes the link from the repository, and the rule is now `node_modules` (no trailing slash), which ignores a folder or a link, like the frontend's rule already does.

**What to do after pulling `develop`.** If `Backend/node_modules` was replaced by a link (`ls -ld Backend/node_modules` shows an arrow), delete it (`rm Backend/node_modules`, only the link) and run `npm ci` in `Backend/`.

**Lesson, for AI assistants and people.** Do not stage with `git add -A` after creating temporary links or files in a checkout; stage the named files. A link needs the ignore rule without the trailing slash.

- **Database:** None. **Config and dependencies:** none (the lock file is unchanged). **Money impact:** None.
- **Tested.** On a clean reinstall (`npm ci`) the backend suite runs again; the link is gone from the tree; `git status` is clean apart from the two files above.

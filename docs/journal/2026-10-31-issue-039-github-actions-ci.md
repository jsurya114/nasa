# Add GitHub Actions CI for pull requests into `develop`

Legacy ID: J-007 (written before this folder existed; the ID is no longer used).

| Field | Value |
|---|---|
| Date | 31 October 2026 |
| Author | Jayasoorya Suryadas, with Claude Code (requested by Jasil) |
| Branch / PR | `ci/github-actions` / pull request into `develop` (issue #39) |
| Type / scope | `ci(repo)` |
| Files touched | `.github/workflows/ci.yml` (new), `.nvmrc` (new), `CONTRIBUTING.md` (§5), `AGENTS.md` (rule 11), `docs/JOURNAL.md` |
| Reserved files touched | None |

**What and why.** Every pull request into `develop` now runs automatic checks, so mistakes are caught before review.

- **Commit messages:** runs `.githooks/commit-msg` on every non-merge commit in the PR.
- **Frontend:** `npm ci`, `npm run lint`, `npm run build` (placeholder `VITE_BACKEND_LOCALHOST_ROUTE`).
- **Backend:** `npm ci`, then `node --check` on every `.js` file outside `node_modules`. `npm test` is not used because it is still the placeholder.
- **Dependency audit:** `npm audit --audit-level=high` in both folders.

**Blocking and non-blocking.**
- Blocking: commit messages, frontend install and build, backend install and syntax check.
- Non-blocking for now: frontend lint (80 existing problems, cleanup in issue #40, then make it blocking) and both audits (the `xlsx` finding stays until issue #25).

**Rules kept.** Trigger is `pull_request` only (never `pull_request_target`). `permissions: contents: read`. No secrets, no deploy steps, nothing touches `main` or production. npm is cached and outdated runs are cancelled. Official actions only (`actions/checkout@v7`, `actions/setup-node@v7`).

**Team rule added.** Branch protection is not available on our plan, so a failed check does not stop a merge. `CONTRIBUTING.md` §5 and `AGENTS.md` (rule 11) now say: never merge a pull request with failing CI.

**Scope note.** CI runs only for pull requests into `develop`, as requested. The `develop` to `main` pull request is not covered by this workflow.

**Database.** None.

**Config and dependencies.** New `.nvmrc` containing `22`. No new packages. No repository secrets.

**Money impact.** None. No Excel, pay or dashboard file was touched.

**Tested.** Ran every step locally first: frontend install and build pass, frontend lint fails today (80 problems), backend syntax check passes on all 63 files, the commit hook accepts a good message and rejects a bad one, the YAML parses. The pull request shows the real runs: one passing run on this branch, and one failing run on a throwaway demo pull request with a bad commit message (linked in the pull request description).

**Risks and follow-ups.**
- `.nvmrc` says `22` because that is the version on the development machines. Confirm what production uses (Vercel project setting for the frontend, the backend host's setting) and change the file if it differs.
- After this is merged, update #36, #37 and #38 from `develop` so CI runs on them.
- GitHub Free has a monthly limit on Actions minutes for private repositories. Watch usage.

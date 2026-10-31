# Journal

The team's record of every change to code, the database, configuration, dependencies and repository settings. Read it from the top before you start any task. Rules for writing entries are in [ENGINEERING_STANDARD.md §8](ENGINEERING_STANDARD.md#8-the-journal).

- Newest entry first. Never edit or delete an old entry. Add a correcting entry instead.
- Public repository: no secrets, real data or exploit steps.

## Active ownership

| Area | Owner | Note |
|---|---|---|
| Excel, pay and dashboard zone. Backend: `weeklyUploadsController`, `fileUploadsController`, `dashboardController`, `analyticsController`, `weeklyExcelQueries`, `excelFileQueries`, `dashboardQueries`, `analyticsQueries`, Excel settings in `multerConfig`, new payroll and QuickBooks files. Frontend: `Dashboard`, `DashboardTable`, `DoubleStop`, `DriverPaymentUpdate`, `Analystic`, `UploadedData`, `TempUploadedData` and their slices (`dashSlice`, `dashboardUpdateSlice`, `paymentDashboardSlice`, `excelSlice`, `doublestopSlice`, `analyticsSlice`) | Jasil | Leave alone. Ask first. Issues #24 to #32. |
| Everything else (auth, middleware, route files, `app.js`, drivers, admins, cities, routes, journeys, availability, access codes, agreements, logging, docs, migrations, mobile app, UI refresh outside Jasil's screens) | Jayasoorya | Issues #3 to #23. |
| Old `dev` branch | Jasil | Do not delete. Has 7 commits not on `main`. Issue #27. |

## In progress

| Branch | Owner | Area |
|---|---|---|
| `ci/github-actions` | Jayasoorya | `.github/workflows/ci.yml` (new), `.nvmrc` (new), `CONTRIBUTING.md` §5, `AGENTS.md`. Issue #39. |

## Entries

### J-007 — Add GitHub Actions CI for pull requests into `develop`

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

### J-003 — Make `develop` the default branch

| Field | Value |
|---|---|
| Date | 31 October 2026 |
| Author | Jayasoorya Suryadas, with Claude Code |
| Branch / PR | `docs/journal-default-branch` / pull request into `develop` |
| Type / scope | `chore(repo)` (repository setting, recorded as `docs(docs)`) |
| Files touched | `docs/JOURNAL.md` |
| Reserved files touched | None |

**What and why.** The GitHub default branch changed from `main` to `develop`, so fresh clones and new pull requests start on `develop` and receive the team rules. Part of issue #3.

**Checked before and after.** Vercel's Production Branch is fixed to `main` (Settings, Environments), so production does not follow the GitHub default. The latest production deployment stayed the same (`1502ac7`, 10 October) and no new deployment started. Pull requests still need an explicit `--base develop`.

**Still open on issue #3.**
- Vercel blocks new deployments with "Git author must have access to the project". This started after the repository became private and needs a fix in the Vercel account (the connected GitHub login), not in code. It will also block the first production deploy from `main`.
- Branch protection is not available on a private repository without GitHub Pro.

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None. The Excel and pay code was not touched.

**Tested.** Read the default branch and the production deployment list before and after the change.

**Risks and follow-ups.** If the Vercel setting is ever changed to follow the default branch, a push to `develop` would deploy to production. Keep Production Branch set to `main`.

### J-002 — Split the work between Jayasoorya and Jasil

| Field | Value |
|---|---|
| Date | 31 October 2026 |
| Author | Jayasoorya Suryadas, with Claude Code |
| Branch / PR | `docs/work-split` / pull request into `develop` |
| Type / scope | `docs(docs)` |
| Files touched | `docs/JOURNAL.md` |
| Reserved files touched | None |

**What and why.** The handoff tasks from Jasil are now GitHub issues #3 to #32, each with one assignee and one priority label (`P0-critical` to `P3-low`). Issue #33 is the tracking issue that defines the two file zones, the shared contracts and the order. The zones are drawn so that no issue needs the other person's work. The ownership table above now lists both zones.

**Repository settings.** Created labels `P0-critical`, `P1-high`, `P2-medium`, `P3-low`, `security`, `refactor`, `chore`, `performance` and `excel-pay`. The repository is already private.

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None.

**Tested.** Documentation only. Checked that every issue number in the table exists.

**Risks and follow-ups.** Two shared files can conflict textually: the backend dependency lock file and this journal. Whoever merges second regenerates the lock file and keeps both journal entries.

### J-001 — Add engineering standard and journal

| Field | Value |
|---|---|
| Date | 31 October 2026 |
| Author | Jayasoorya Suryadas, with Claude Code |
| Branch / PR | `docs/engineering-standard` / pull request into `develop` |
| Type / scope | `docs(docs)` |
| Files touched | `docs/ENGINEERING_STANDARD.md` (new), `docs/JOURNAL.md` (new), `CLAUDE.md` (two added lines) |
| Reserved files touched | None |

**What and why.** Adds the engineering standard that every change must follow, and this journal. The standard sets the working rules: work on `develop`, `main` stays untouched until the owner gives the exact instruction, read the journal before a task, record a journal entry after one. The journal lets two people and two AI assistants see each other's changes and avoid conflicts. `CLAUDE.md` now points assistants to both files.

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None.

**Tested.** Documentation only. Checked that links between the files resolve and that the commit message passes the repository hook. No application code was run.

**Risks and follow-ups.** None. Update the ownership table above when Jasil's Excel work finishes.

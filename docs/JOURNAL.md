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
| `fix/token-by-app-area` | Jayasoorya | `Frontend/src/redux/slice/axiosInstance.js`. Issue #9. |
| `fix/auth-role-separation` | Jayasoorya | `Backend/middlewares` (`adminAuth`, `driverAuth`, new `requireRole`), `Backend/controllers/admin/adminController.js`, `Backend/controllers/driver/driverController.js`. Issue #4. |
## Entries

### J-008 — Send each request's own sign-in token

| Field | Value |
|---|---|
| Date | 31 October 2026 |
| Author | Jayasoorya Suryadas, with Claude Code (requested in Jasil's review of PR #36) |
| Branch / PR | `fix/token-by-app-area` / pull request into `develop` (issue #9) |
| Type / scope | `fix(frontend)` |
| Files touched | `Frontend/src/redux/slice/axiosInstance.js`, `docs/JOURNAL.md` |
| Reserved files touched | None |

**What and why.** The browser app chose its token with "admin token if present, else driver token". A browser that held both an admin and a driver session therefore sent the admin token on driver pages, and refreshed the wrong session. Once the server enforces roles (PR #36, issue #4) driver requests would be refused. Now each request uses the tokens of its own area.

- The area comes from the request URL (`/admin/...` or `/driver/...`), and from the page only if the URL does not say.
- The request uses `<area>Token`. A 401 refreshes with `<area>RefreshToken` through `/<area>/refresh-token`, and stores the new pair under the same area.
- If a refresh fails, only that area is signed out and the user goes to that area's login page. The other session is kept. Before, all four tokens were cleared.
- The refresh failure log prints the error message only (same line as PR #38).

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None. No Excel, pay or dashboard file or screen was touched.

**Tested.** A throwaway script (not committed) ran the real interceptor file against the real backend middleware and refresh endpoints, with the database stubbed and a local Redis. 16 checks cover: both sessions open, an expired driver token, an expired admin token, a failed driver refresh, a driver with no refresh token while an admin refresh token exists, single sessions, and no session. Results:
- #36 backend with the old interceptor: 7 failed (driver requests got 403 when both sessions existed).
- #36 backend with the new interceptor: all 16 passed.
- current `develop` backend with the new interceptor: all 16 passed (no regression).
Not tested: a real browser, and a real database.

**Risks and follow-ups.** Merge this before or together with PR #36. The two lines in `console.error(...)` and this file overlap with PR #38, so whichever merges second needs a one-line conflict check. Nothing else reads the stored tokens directly.

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

### J-004 — Keep driver and admin sign-ins in their own areas

| Field | Value |
|---|---|
| Date | 31 October 2026 |
| Author | Jayasoorya Suryadas, with Claude Code |
| Branch / PR | `fix/auth-role-separation` / pull request into `develop` (issue #4) |
| Type / scope | `fix(auth)` |
| Files touched | `Backend/middlewares/requireRole.js` (new), `Backend/middlewares/adminAuth.js`, `Backend/middlewares/driverAuth.js`, `Backend/controllers/admin/adminController.js`, `Backend/controllers/driver/driverController.js` |
| Reserved files touched | None |

**What and why.** A sign-in token now works only in its own area. Driver tokens carry `role: 'driver'`. Admin routes accept only the `admin` and `superadmin` roles, and driver routes accept only the driver role. A wrong-role token gets `403 FORBIDDEN`. Both refresh endpoints also refuse a refresh token from the other area. A new shared `requireRole()` middleware does the check, so later routes can reuse it.

**Contract kept.** `req.user`, `req.admin` and `req.driver` keep their fields. Admin role names are unchanged. Driver tokens gain one field (`role`).

**Grace period.** Driver tokens issued before this change have no role. Admin tokens always had one, so a role-less token can only be an old driver token. It is accepted on driver routes only, and it still works on no admin route. These tokens die on their own within 7 days (refresh tokens last 7 days), because nothing issues role-less tokens any more. Issue #14 removes the allowance from the code.

**Database.** None.

**Config and dependencies.** None. No new environment variable.

**Money impact.** None. No Excel, pay or dashboard file was touched.

**Tested.** A throwaway script (not committed) ran the real middleware against a local Redis: admin and superadmin tokens on admin routes (200), driver token and old role-less token on admin routes (403), driver and old role-less tokens on driver routes (200), admin and superadmin tokens on driver routes (403), no token (401), and a refresh token from the wrong area on each refresh endpoint (401). All 12 passed. The same script failed 4 of 12 on the code before this change. Not tested: a full login and refresh with a real database, and the frontend in a browser.

**Risks and follow-ups.**
- A browser that holds both an admin token and a driver token sends the admin token on driver pages today, so driver pages will now be refused there. Issue #9 (send the token for the current app area) fixes this. Merge #9 before the next release to `main`. Normal users hold one token and are not affected.
- Issue #14 removes the role-less allowance after 7 days in production.

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

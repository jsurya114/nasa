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
| `fix/stop-logging-sensitive-data` | Jayasoorya | `Backend/app.js`, `Backend/services/admin/dbQueries.js`, `Backend/services/redis-jwt-service.js`, `Backend/utils/availabilityCronJob.js`, three frontend slices (log lines only). Issue #6. |
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

### J-006 — Stop logging passwords, tokens and request data

| Field | Value |
|---|---|
| Date | 31 October 2026 |
| Author | Jayasoorya Suryadas, with Claude Code |
| Branch / PR | `fix/stop-logging-sensitive-data` / pull request into `develop` (issue #6) |
| Type / scope | `fix(security)` |
| Files touched | `Backend/app.js`, `Backend/services/admin/dbQueries.js`, `Backend/services/redis-jwt-service.js`, `Backend/utils/availabilityCronJob.js`, `Frontend/src/redux/slice/admin/userLoadSlice.js`, `Frontend/src/redux/slice/driver/passwordSlice.js`, `Frontend/src/redux/slice/axiosInstance.js` |
| Reserved files touched | None |

**What and why.** Logs must never hold passwords, tokens, personal data or whole request bodies. Searched every live `console` call in the backend and the sign-in related ones in the frontend. Removed or trimmed these:

- Backend `dbQueries.js`: removed the log of the whole driver update object (it held the plain password, email and phone).
- Backend `redis-jwt-service.js`: the logout log no longer prints the access token.
- Backend `app.js`: the request log for `/admin` and `/driver` now prints only the method and path, with no query string and no part of the `Authorization` header.
- Backend `availabilityCronJob.js`: the weekly reset log lists driver IDs, not names and driver codes.
- Frontend `userLoadSlice.js`: removed the two logs of the "add driver" and "add admin" form (they held the plain password).
- Frontend `passwordSlice.js` and `axiosInstance.js`: log the error message only, not the whole axios error (it carries the request body: the passwords or the refresh token).

**Left alone on purpose.**
- Other frontend `console.log` calls (route, job and delivery data). They hold no secrets. Issue #18 (one small logger) removes them.
- Backend `dashboardQueries.js` (Jasil's zone) prints the payment update query and its values, which include the driver's name. Passed to Jasil to remove in his own work (issue #24 or #26).

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None. Only log lines changed, and no Excel, pay or dashboard file was touched.

**Tested.** A throwaway script (not committed) captured what the real code prints. It ran the real `updateDriver` with a password, email and phone, the real token blacklist, and the real `app.js` as a child process with a request carrying a token and an email in the query string. All 7 checks passed, and 6 of them failed on the code before the change. Syntax checked on every changed backend file. Not tested: the frontend in a browser.

**Risks and follow-ups.** Existing logs on the server may already hold old values from before this change. Consider clearing or rotating those logs, and treat any password that was in them as exposed. Issue #18 will add a logger that redacts by default.

### J-005 — Drivers only see and change their own data

| Field | Value |
|---|---|
| Date | 31 October 2026 |
| Author | Jayasoorya Suryadas, with Claude Code |
| Branch / PR | `fix/driver-own-data` / pull request into `develop` (issue #5) |
| Type / scope | `fix(drivers)` |
| Files touched | `Backend/middlewares/requireSelf.js` (new), `Backend/routes/driverRoutes.js` |
| Reserved files touched | None |

**What and why.** Five driver endpoints took the driver ID from the URL or the request body. They now compare it with the ID in the verified token and answer `403 FORBIDDEN` when it belongs to someone else. A new shared `requireSelf(field, source)` middleware does the check. The URLs and body shapes are unchanged, so the driver app and the frontend keep working.

**Endpoints covered.**
- `GET /driver/deliveries/:driverId`
- `GET /driver/journey/:driver_id`
- `POST /driver/journey` (body `driver_id`)
- `GET /driver/language/:driverId`
- `PUT /driver/language` (body `driverId`)

**Behaviour details.** An ID that is not a plain whole number (text, decimals, arrays, objects) is refused. If the field is not sent at all, the request passes on and the controller's own validation answers, so nothing is read or written for another driver. Other driver routes already used the token's ID and were not changed.

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None. The delivery summary query and the pay code were not changed, and no Excel, pay or dashboard file was touched.

**Tested.** A throwaway script (not committed) ran the real `driverRoutes` router and the real `driverAuth` against a local Redis, with only the database call stubbed so every query could be recorded. 18 checks all passed: own ID works on all five endpoints, another driver's ID gets 403 and no query runs for that ID, odd input (`7abc`, `7.5`, array, object) gets 403, and a missing field reaches the controller's own 400. The same script failed 10 of 18 on the code before this change. Not tested: a real database, and the frontend in a browser.

**Risks and follow-ups.** The frontend sends the signed-in driver's own ID everywhere these endpoints are used, so nothing should change for drivers. Please check the delivery page, today's journey, saving a journey and the language switch once on this branch. Issue #4 (pull request in review) is independent: this change does not need it.

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

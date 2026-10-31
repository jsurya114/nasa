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
| `fix/driver-own-data` | Jayasoorya | `Backend/middlewares/requireSelf.js` (new), `Backend/routes/driverRoutes.js`. Issue #5. |

## Entries

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

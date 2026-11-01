# Contributing

| Field | Value |
|---|---|
| Version | 1.0 |
| Owners | Jasil M, Jayasoorya Suryadas |
| Last updated | 31 October 2026 |
| Applies to | Every commit and pull request in this repository, by every team member and every AI assistant |

`main` is live production. A `commit-msg` hook checks commit messages automatically and a `pre-push` hook blocks direct pushes to `main` and `develop`. See [§8](#8-one-time-setup).

AI assistants must also follow [AGENTS.md](AGENTS.md).

---

## Contents

1. [Branching](#1-branching)
2. [Releasing to production](#2-releasing-to-production)
3. [Commit messages](#3-commit-messages)
4. [Commit hygiene](#4-commit-hygiene)
5. [Pull requests](#5-pull-requests)
6. [Changing code without breaking it](#6-changing-code-without-breaking-it)
7. [Quick reference](#7-quick-reference)
8. [One-time setup](#8-one-time-setup)
9. [When things go wrong](#9-when-things-go-wrong)

---

## 1. Branching

Work moves in one direction: **feature branch → `develop` → `main`**.

| Branch | Purpose | Rules |
|---|---|---|
| `main` | Live production | Changes only through a pull request **from `develop`**. No direct pushes, and no pull requests from any other branch. |
| `develop` | Where finished work comes together and gets tested | Changes only through pull requests from feature branches. |
| `<type>/<short-description>` | One piece of work, for example `fix/driver-route-access` | Branch from `develop`, and open the pull request back into `develop`. Delete it after merging. |

- Never force-push `main` or `develop`. Don't rebase or amend commits that are already on them.
- Keep your branch up to date: `git fetch origin`, then `git merge origin/develop`.
- Only a hotfix for a live outage may skip the queue, and it still goes through a pull request. See [§9](#9-when-things-go-wrong).

## 2. Releasing to production

- Only a team member decides when `develop` goes to `main`.
- **An AI assistant never opens a pull request into `main` on its own.** It may do so only when a team member tells it to in the current conversation and names that pull request.
- Before a release, test `develop` end to end using the checklist in [§6](#6-changing-code-without-breaking-it).
- If a release needs a database change, take a backup first and write the steps in the pull request.

---

## 3. Commit messages

We follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/), plus the rules below. Every message must say **what** changed and **why** without anyone opening the code.

### 3.1 Format

```text
<type>(<scope>): <subject>

<body: why the change is needed>

- <what changed, one bullet per notable change>

<footer: trailers>
```

Example:

```text
fix(journeys): use the driver's local date for new journeys

Journeys started late in the evening could be saved under the wrong
day, so the matching pay row was not found.

- Pass the driver's local date into the journey query
- Keep the database default for older clients

Refs: #12
```

### 3.2 Type

| Type | Use for |
|---|---|
| `feat` | A new user-facing capability or behaviour |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `style` | Formatting only. No change in behaviour |
| `refactor` | Restructuring code without changing behaviour |
| `perf` | A performance improvement |
| `test` | Adding or correcting tests only |
| `build` | Build system, packaging or dependencies |
| `ci` | CI configuration |
| `chore` | Maintenance that fits no other type (repo config, scripts) |
| `revert` | Reverting an earlier commit |

### 3.3 Scope

The scope names the part of the system a commit changes. It is **required** for `feat`, `fix`, `refactor`, `perf` and `test`, and optional for other types. Use exactly one scope. If a change spans several, it probably belongs in several commits.

The allowed scopes are listed in [`.githooks/scopes`](.githooks/scopes), one per line. The hook reads that file.

| Group | Scopes |
|---|---|
| Apps | `frontend`, `backend`, `mobile` |
| Cross-cutting | `auth`, `db`, `api`, `ui`, `validation`, `i18n`, `security` |
| Repository | `deps`, `config`, `repo`, `readme`, `docs` |
| Domain modules | `drivers`, `admins`, `cities`, `routes`, `journeys`, `deliveries`, `availability`, `access-codes`, `agreements`, `excel`, `payroll`, `quickbooks`, `dashboard`, `analytics` |

To add a scope, add a line to `.githooks/scopes` and to the table above in the same commit (`chore(repo): add invoices scope`).

### 3.4 Header rules

| Rule | Correct | Incorrect |
|---|---|---|
| Maximum 72 characters (aim for about 50) | `fix(auth): reject expired tokens` | A header that wraps in `git log --oneline` |
| Imperative mood: it completes "If applied, this commit will …" | `add`, `fix`, `remove`, `rename` | `added`, `fixes`, `updating` |
| First word lowercase (acronyms such as API and CSV may stay uppercase) | `add CSV export of pay runs` | `Add CSV export…` |
| No full stop at the end | `… for city admins` | `… for city admins.` |
| Describe the change, not the activity | `reject negative package counts` | `update`, `changes`, `final`, `done`, `wip` |
| Name the behaviour, not the file | `show field errors on driver login` | `edit DriverLogin.jsx` |

### 3.5 Body rules

- **Required** for `feat` and `fix`. Optional for other types when the header says it all.
- Leave **one blank line** after the header.
- **Explain why first**: the problem, the requirement or the context. The diff already shows *how*.
- Then list **what** changed, one bullet per notable change, each starting with an imperative verb.
- Mention anything a teammate must act on: "New env var `REFRESH_TOKEN_SECRET`", or "Run the new migration after pulling".
- Wrap lines at **72 characters**. The hook rejects lines over 100 characters, except URLs.
- Write in plain English. No emojis, and no references to private chats.

### 3.6 Footer (trailers)

Trailers go at the end, after one blank line, one per line, in `Key: value` form.

| Trailer | When | Example |
|---|---|---|
| `Refs:` | The commit relates to an issue | `Refs: #12` |
| `Closes:` | The commit completes an issue | `Closes: #12` |
| `BREAKING CHANGE:` | An API contract or the schema changes in a way others must adapt to | `BREAKING CHANGE: /admin/journeys now returns { items, total }` |
| `Co-authored-by:` | Someone else paired on the commit, or an AI assistant wrote part of it | `Co-authored-by: Name <email>` |

### 3.7 Breaking changes

Add `!` after the type or scope, **and** explain the break in a `BREAKING CHANGE:` trailer:

```text
feat(api)!: paginate the journeys endpoint

The full journey list got slower as history grew.

- Return { items, total, page, pages } from GET /admin/journeys
- Default to 50 rows per page

BREAKING CHANGE: GET /admin/journeys returns an object, not an array.
```

### 3.8 Reverts

```text
revert: fix(excel): skip rows without a route

This reverts commit 1a2b3c4d.

Skipping those rows dropped valid deliveries from the weekly total.
```

### 3.9 Messages we don't accept

| Message | Problem |
|---|---|
| `update` / `changes` / `final` / `done` / `wip` / `small changes` | Says nothing about the change |
| `Fixed bug` | No type or scope, past tense, and which bug? |
| `feat: stuff for login and dashboard and api` | Several changes in one commit, and vague |
| `feat(auth): Added login.` | Past tense, capitalised, full stop, no body |
| `fix(ui): fix` | The subject repeats the type and explains nothing |

---

## 4. Commit hygiene

1. **One logical change per commit.** A fix and its docs belong together. An unrelated refactor or a formatting pass doesn't.
2. **Commit your own work** under your own name and email. If you paired, add a `Co-authored-by:` trailer.
3. **`develop` and `main` always start.** Run the app, or at least the frontend build and the backend start-up, before pushing.
4. **Never commit secrets**: `.env` files, API keys, database passwords or JWT secrets.
5. **Never commit generated output or private data**: `node_modules/`, `dist/`, `.DS_Store`, uploaded Excel files, or real driver and client data.
6. **This repository is public.** Describe a security fix by what it now protects. Never write the steps to exploit it in commits, pull requests or issues.
7. **Don't bypass the hooks.** We don't use `git commit --no-verify`. If a hook rejects your message, fix the message.

---

## 5. Pull requests

- **Target:** feature branches target `develop`. Only `develop` targets `main`.
- **Title:** use the commit header format, `<type>(<scope>): <subject>`, at most 72 characters. It becomes the commit message when the pull request is squashed.
- **Description:** fill in [the template](.github/pull_request_template.md), including how you tested it, whether it is AI-assisted, and any limitations.
- **Review:** the other developer approves. The author never approves or merges their own pull request. The reviewer runs the branch before approving anything that touches pay, Excel uploads, login or the database.
- **CI:** every pull request into `develop` runs `.github/workflows/ci.yml`: commit messages, frontend lint and build, backend syntax check and a dependency audit. Lint and the audit are non-blocking for now. **Never merge a pull request with failing CI.** We have no branch protection, so GitHub will not stop you; the rule is ours to keep. Fix the failure, or ask the other developer, before merging.
- **Merge method:** **"Squash and merge"** for every pull request into `develop`. One pull request becomes one commit on `develop`, so the history reads one line per change and a bad change can be reverted in one step. The squashed commit takes the pull request **title**, so the title must follow the commit header format above. Don't use "Create a merge commit" or "Rebase and merge" for these. The release pull request from `develop` into `main` is a separate decision (see `docs/journal/2026-11-01-pr-062-squash-merge.md`); until the owner decides, ask before merging it.
- **After merging:** delete the feature branch. Never delete `develop`.
- **Size:** about 300 changed lines or fewer. Anything bigger is split. Deleting dead code doesn't count towards the limit.

---

## 6. Changing code without breaking it

The system has no automated tests yet, so these rules are what protect production.

1. **Keep refactors and behaviour changes in separate pull requests.** A `refactor` pull request changes no pay amount, API response shape, URL or database schema. If you find a bug while refactoring, fix it in its own `fix` pull request.
2. **Work in small steps.** One controller or module per pull request, so any one of them can be reverted alone.
3. **Add before you remove.** Build the new function or middleware next to the old one, move callers across one at a time, then delete the old code in a later pull request.
4. **Check money before and after.** For anything touching pay, rates, deductions or Excel imports, run the same sample files before and after your change. Totals must match to the cent, or the pull request must explain every difference.
5. **Change the database in stages.** Add the new column or table, backfill it, switch the code to it, and remove the old one in a later pull request. Never rename or drop in the same step. Take a backup before any destructive change.
6. **Never rewrite paid history.** Records already marked as paid must not change when a rate or calculation changes.
7. **Run the regression checklist** before asking for review on anything touching those areas:
   - Log in and out as super admin, city admin and driver
   - Start and finish a journey as a driver, in a daily city
   - Upload a daily SpeedX file and a weekly GOFO file
   - Compare dashboard and payment totals with the previous result
   - Mark a pay run as paid in one city and confirm other cities are unchanged

---

## 7. Quick reference

```text
<type>(<scope>): <subject>          ≤ 72 chars, imperative, lowercase, no full stop
                                    (blank line)
Why the change is needed.           required for feat and fix
                                    (blank line)
- What changed                      one bullet per notable change
                                    (blank line)
Refs: #12                           trailers

types   feat fix docs style refactor perf test build ci chore revert
scopes  see .githooks/scopes

start   git switch develop → git pull → git switch -c fix/<name>
finish  gh pr create --base develop → review → merge → delete the branch
flow    feature branch → develop → main     (pull requests only)
```

---

## 8. One-time setup

Run these once in your clone:

```bash
git config core.hooksPath .githooks
```

```bash
git config commit.template .gitmessage
```

Check that `git config user.name` and `git config user.email` match your own GitHub account.

To check a message without committing:

```bash
printf 'fix(auth): reject expired tokens\n\nWhy.\n\n- What\n' > /tmp/msg && .githooks/commit-msg /tmp/msg && echo OK
```

---

## 9. When things go wrong

| Problem | Fix |
|---|---|
| `git push` rejected (non-fast-forward) | `git pull --rebase`, resolve any conflicts, then `git push`. Never `--force`. |
| Merge conflict from `develop` | Edit the conflicted files, `git add <file>`, then `git commit`. If you're lost: `git merge --abort` and ask the other developer. |
| Hook rejected your message | Read the reasons it prints, fix the message and commit again. Your staged changes are still there. |
| Typo in the last commit message, **not pushed yet** | `git commit --amend` |
| Typo in a commit that's **already pushed** | Leave it. Don't rewrite pushed history. |
| Committed a secret | Tell the other developer **straight away**. Rotate the secret, then remove it in a new commit. |
| Broke `develop` | Fix it right away in a new branch, or `git revert <sha>`, and open a pull request. |
| Production is down | Both developers agree on the fix. A person, not an AI assistant, opens the pull request from `hotfix/<name>` into `main`, then merges `main` back into `develop` straight away. |

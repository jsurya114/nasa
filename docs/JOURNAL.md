# Journal

The team's record of every change to code, the database, configuration, dependencies and repository settings. It exists so two people, or two AI assistants, do not edit the same thing in different ways. Rules: [ENGINEERING_STANDARD.md §8](ENGINEERING_STANDARD.md#8-the-journal).

## One file per task

Entries live in [`journal/`](journal/), **one file per task**. A pull request adds its own new file and never edits anyone else's, so journal entries never conflict.

**File name:** `YYYY-MM-DD-issue-NNN-short-title.md`

- `NNN` is the GitHub issue number, padded to three digits (`issue-009`). The issue number is unique, so two branches can never pick the same name. Use `pr-NNN` if there is no issue.
- Files sort by date, then by issue number, so `ls -r docs/journal` lists the newest first.
- There are no sequential IDs. Entries written before this folder existed carry a "Legacy ID" line.

**Never edit or delete another entry.** If one was wrong, add a new file that says which entry it corrects. You may edit your own entry while your pull request is still open.

**Public repository rules:** no secrets, real data or exploit steps.

## When to write one

Any pull request that changes code, the database, configuration, dependencies or repository settings, in the same pull request. A typo fix in a comment does not need one.

## Before you start a task

```bash
git pull origin develop
ls -r docs/journal | head -15     # newest entries
gh pr list                        # work in progress
gh pr diff <number> --name-only   # files an open pull request changes (and its journal file)
```

Also read [OWNERSHIP.md](OWNERSHIP.md). If your task touches a file named in a recent entry, a file an open pull request changes, or an area owned by someone else, talk to the owner first.

## Template

Copy this into `docs/journal/YYYY-MM-DD-issue-NNN-short-title.md`.

```markdown
# Short title of the change

| Field | Value |
|---|---|
| Date | Date of the change |
| Author | Person, and the AI tool if one helped |
| Issue / PR | `#NNN` / `#NNN` |
| Branch | `type/short-description` |
| Type / scope | Same as the commit header, for example `fix(auth)` |
| Files touched | Paths |
| Reserved files touched | None, or which (see OWNERSHIP.md) |

**What and why.** Plain English. No exploit steps, no secrets, no real data.

**Database.** None, or the exact SQL and the rollback.

**Config and dependencies.** None, or new or changed environment variables and added or removed packages.

**Money impact.** None, or before and after totals.

**Tested.** What you ran, and what you did not.

**Risks and follow-ups.** Anything the next person must know before touching the same area.
```

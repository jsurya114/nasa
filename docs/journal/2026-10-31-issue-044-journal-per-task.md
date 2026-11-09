# One journal file per task

| Field | Value |
|---|---|
| Date | 31 October 2026 |
| Author | Jayasoorya Suryadas, with Claude Code |
| Issue / PR | `#44` / pull request into `develop` |
| Branch | `docs/journal-per-task` |
| Type / scope | `docs(docs)` |
| Files touched | `docs/JOURNAL.md` (now the how-to), `docs/OWNERSHIP.md` (new), `docs/journal/` (new, 6 files), `docs/ENGINEERING_STANDARD.md` (§1, §8, version 1.1), `CLAUDE.md` |
| Reserved files touched | None |

**What and why.** Every pull request added its entry at the top of one shared `docs/JOURNAL.md` and edited the same "In progress" table, so any two open pull requests conflicted there. Entries now live one per file in `docs/journal/`, named `YYYY-MM-DD-issue-NNN-short-title.md`. Each pull request adds only its own new file, so journal entries cannot conflict. The issue number is unique, so two branches cannot pick the same name (sequential IDs like J-009 could collide).

**What changed.**
- The five existing entries on `develop` (J-001, J-002, J-003, J-005, J-007) moved into their own files with their text unchanged and a "Legacy ID" line.
- The "Active ownership" table moved to `docs/OWNERSHIP.md`. It changes rarely.
- The "In progress" table was removed. `gh pr list` is the source of truth, so it cannot go stale.
- `docs/JOURNAL.md` is now the short how-to with the template and the commands to read the journal before a task.
- `ENGINEERING_STANDARD.md` rules 4, 5 and 7 and section 8 describe the new way. Version 1.1. `CLAUDE.md` points assistants to the folder.

**Approval.** `ENGINEERING_STANDARD.md` §10 says changes need both owners' approval, so this pull request needs Jasil as well as Jayasoorya.

**Database.** None.

**Config and dependencies.** None.

**Money impact.** None. No application code changed.

**Tested.** Documentation only. A script compared the original text of each moved entry with its new file: all five identical. Checked that every relative link in the changed docs resolves. Not applicable: application tests.

**Risks and follow-ups.**
- Open pull requests #36, #38 and #43 still edit `docs/JOURNAL.md` (their entries J-004, J-006 and J-008). After this is merged, each is updated once: it drops its edits to `JOURNAL.md` and adds its entry as its own file (`issue-004`, `issue-006`, `issue-009`). After that, journal conflicts are gone.
- Entries in this folder sort by date, then by issue number, not by time of day.

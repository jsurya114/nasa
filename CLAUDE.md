# Instructions for AI assistants

@AGENTS.md
@docs/ENGINEERING_STANDARD.md

Before every task, read the newest files in `docs/journal/`, `docs/OWNERSHIP.md` and `gh pr list` (how-to: `docs/JOURNAL.md`). After every code, database or configuration change, add a new file `docs/journal/YYYY-MM-DD-issue-NNN-short-title.md` in the same pull request. Never add your entry to a shared file. `main` stays untouched until the repository owner writes "raise pr to main from develop" in the current conversation.

`main` is production. Every pull request uses `--base develop`. Never open a pull request into `main` unless a team member tells you to in the current conversation and names that pull request.

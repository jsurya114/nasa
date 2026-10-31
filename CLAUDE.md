# Instructions for AI assistants

@AGENTS.md
@docs/ENGINEERING_STANDARD.md

Before every task, read `docs/JOURNAL.md` from the top. After every code, database or configuration change, add a journal entry in the same pull request. `main` stays untouched until the repository owner writes "raise pr to main from develop" in the current conversation.

`main` is production. Every pull request uses `--base develop`. Never open a pull request into `main` unless a team member tells you to in the current conversation and names that pull request.

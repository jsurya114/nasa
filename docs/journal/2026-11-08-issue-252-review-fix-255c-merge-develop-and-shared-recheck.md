# Housekeeping for PR #255: develop merged, one shared re-match recheck

- Date: 8 November 2026
- Author: Jayasoorya with Claude Code
- Issue: #252; PR #255; branch `feat/gofo-statement-api`
- Type and scope: fix, `statementStore.js` only (and this note). No reserved file.

## What and why

`develop` moved when #253 was squash-merged, so this branch is brought up to date through #254 (no conflicts left). PR #254 now puts the hold-and-recheck of the pay rows inside
`rematchOpenGroups` for every caller, so the manual re-match here no longer repeats it and the duplicate `StatementWorkChanged` class is removed. Behaviour is unchanged: a re-match whose
journeys changed meanwhile is undone and the endpoint answers 409.

## Database, config, dependencies

None. Money impact: none.

## Tested

- `gofoStatementApi`, `gofoStatementStore`, `gofoStatementWorkGuard` on a clean local copy of the database: 18 pass.

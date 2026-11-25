# Backend deploy runbook (no more `git pull` on the server)

| Field | Value |
|---|---|
| Date | 2026-11-25 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR) |
| Branch | `docs/backend-deploy-runbook` (from `develop`) |
| Type / scope | `docs(repo)` |
| Files touched | `docs/infra/DEPLOY_RUNBOOK.md` (new), `docs/infra/VPC_MIGRATION.md` (one pointer), this entry. |
| Reserved files touched | None. |

**What and why.** Before the move, a backend deploy was `git pull` and a PM2 restart over SSH. The new server runs a packed copy of the backend from the release bucket, so merging to `main` deploys nothing. The new runbook says what a deploy now is: pack and upload from `origin/main` (`package-backend.sh`), then either replace the instance (route A, a few minutes down, which doubles as the recovery drill) or swap the app folder on the running instance (route B, interim). It also covers what a deploy does not do: database migrations are run by hand first, and a new setting must be in SSM before the code that reads it. It has the checks, the rollback and the point that uploading changes what any new instance installs. `VPC_MIGRATION.md` section 7 now links to it.

**Review changes (Jasil's review, same day).** (1) Route B now refuses to run if `Backend.prev` or `Backend.bad` already exists, so a second swap cannot move the live folder inside the old one; the revert has the same guard. (2) The route B revert, and the rollback section, now copy the previous build back over `backend-latest.tgz`, so a later boot or replacement does not install the bad release. (3) A migration is preceded by an RDS snapshot (named in the journal entry of that deploy). (4) `export HOME=/root` before `npm ci` (Run Command may not set it; to be checked at first use), `/tmp/rel.tgz` is removed after unpacking, and a new rule says the backend goes before the Vercel frontend when a release changes the API.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** Read against `package-backend.sh`, the boot script (`user_data.sh.tpl`) and `VPC_MIGRATION.md` section 7 for consistency. **Not tested:** route A on production (the planned recovery drill), route B (the folder swap), the revert and the review changes above (the script blocks pass `bash -n` apart from the placeholders). Nothing in AWS was run or changed.

**Risks and follow-ups.** Both owners read it before the first deploy and fix it from what the first use shows. A GitHub Action that packs on merge to `main` is noted as a later idea, not built.

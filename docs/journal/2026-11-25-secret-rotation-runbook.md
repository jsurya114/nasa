# Secret rotation runbook and a re-render script (proposal)

| Field | Value |
|---|---|
| Date | 2026-11-25 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR) |
| Branch | `docs/secret-rotation-runbook` (from `develop`) |
| Type / scope | `docs(repo)` (infrastructure) |
| Files touched | `docs/infra/SECRET_ROTATION_RUNBOOK.md` (new), `docs/infra/scripts/rerender-env.sh` (new), `docs/infra/VPC_MIGRATION.md` (section 6 item 4, section 7), `docs/infra/CUTOVER_RUNBOOK.md` (section 6 item 4), this entry. |
| Reserved files touched | None. |

**Why.** The old server's `.env` was once pasted into a chat, so every value in it is treated as exposed. The steps to replace them are written down for both owners to read before anything is run, as for the cutover and the Terraform apply.

**What it contains.**
- `SECRET_ROTATION_RUNBOOK.md`: the rules (no value in chat, repo, logs or shell history; one secret per window; both owners say go; not before the old server is deleted), a table of the eight groups in the order to do them with the cost of each and how to check it, the steps for one setting (new value at the provider, into SSM without showing it, re-render and restart, check, revoke the old one, undo), notes per setting, and what to clean up afterwards.
- `scripts/rerender-env.sh`: re-renders `/opt/nasa/Backend/.env` from SSM with the same `render-env.cjs` as the boot script, so no value is typed on the server. A dry run prints only the *names* of settings that differ. `--apply` installs the file (mode 600), keeps the old one as `.env.before-rotation`, restarts the service and waits for `/healthz`.
- It adds secrets that were not in the old list in `CUTOVER_RUNBOOK.md` section 6: `REFRESH_TOKEN_SECRET` and the reporting database password. It also records that `QUICKBOOKS_TOKEN_KEY` encrypts the saved QuickBooks tokens (from `Backend/.env.example`), so changing it means reconnecting QuickBooks.

**Tested (25 November 2026).** The script's syntax (`bash -n`), and its dry run on the production server through SSM: it rendered from SSM, named only `SCHEDULED_JOBS_ENABLED` as different (written by hand without quotes at the cutover; both read the same), changed nothing, and `/healthz` stayed ok. No value was printed or stored outside the server. **Not tested:** `--apply` on production, any provider-side step, and every "check afterwards". The runbook says so and asks to start with the least risky setting.

**Database.** None. **Config and dependencies.** None. **Money impact.** None until the runbook is followed; its Everee and QuickBooks rows say how to avoid a pay run.

**Risks and follow-ups.** Merging changes nothing in AWS. The values are not rotated yet: that waits for the end of the rollback week and for the old server to be deleted. Review the table (especially rows 4 to 6 and 8) before the first rotation.

# Cutover runbook: move the old Elastic IP to the new server

| Field | Value |
|---|---|
| Date | 2026-11-24 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5); to be reviewed by Jasil |
| Issue / PR | none / pull request into `develop` (see the PR); follows #317 |
| Branch | `docs/cutover-runbook` (from `develop`) |
| Type / scope | `docs(repo)` |
| Files touched | `docs/infra/CUTOVER_RUNBOOK.md` (new), this entry. |
| Reserved files touched | None. |

**What was done.** A step-by-step runbook for the move of production from the old `t3.micro` to the new `t4g.micro`, planned for Tuesday 24 November 2026 at 12:00 IST (12:30 AM US Central). It follows Jasil's four-part plan, with the changes agreed in the Slack thread:
- `api.nasaroutes.com` already points at the old server's Elastic IP, and there is no GoDaddy sign-in, so the cutover moves **that Elastic IP** onto the new server instead of changing DNS.
- Before the window: both servers checked, ports 80 and 443 open on the new server's security group, a fresh RDS snapshot, a dry run of the move, a quiet check, a go or no-go in the thread.
- Cutover: stop the app on the old server first (it cannot be reached after the move), move the address, point the new server's Caddy at `api.nasaroutes.com` (it was set to the test name) and wait for the certificate, check `/healthz` (which only the new server has) and the app, then turn the scheduled jobs on for the new server only.
- Rollback in Jasil's order: jobs off in SSM and `.env`, new server stopped and confirmed inactive, the Elastic IP moved back from the console, then `pm2 start` on the old server.
- After the cutover: a Terraform follow-up plan, release of the spare address, the old server kept stopped for a few days, secret rotation.

**Why.** A written runbook means nothing is improvised in the window, and both people read the same commands first.

**Not covered by the code.** The runbook contains no secrets, no account number and no IP address; every ID is looked up with a command. Changing `api_domain` in Terraform changes the server's startup script and makes the Auto Scaling group replace the instance, so that change is kept for the follow-up plan, in another quiet window. Until then the server's Caddyfile differs from the code by one hand edit (step 3), written down in the runbook.

**Database.** None. **Config and dependencies.** None changed by this pull request. **Money impact.** None.

**Tested.** The commands were checked against the Terraform code and the bootstrap script (the Caddyfile layout, the service names, the `.env` path, the group name) and, earlier, against the real account (snapshot, SSM `send-command`, `put-parameter`). The runbook was read against Jasil's rollback-order review of #317.

**Not tested.** The whole sequence has never been run. Not run before the window: `associate-address` of the old IP (only a dry run is in the pre-checks), the Caddyfile edit and reload on the real server, the certificate for `api.nasaroutes.com`, and the rollback. Whether AWS detaches the spare address by itself when the old one is attached to the same server is checked in step 2 and not assumed.

**Risks and follow-ups.** (1) About 1 to 3 minutes of errors for users, in the quiet window. (2) A webhook sent by Everee in that gap may need to be resent. (3) The Terraform follow-up (import the old address, drop the spare, set `api_domain`) must be a plan both people read, and it replaces the instance. (4) The temporary AdministratorAccess group and the secrets pasted into a chat once are still to be dealt with after the cutover is stable.

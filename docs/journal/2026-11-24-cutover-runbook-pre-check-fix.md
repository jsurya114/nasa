# Cutover runbook: fix the first pre-check

| Field | Value |
|---|---|
| Date | 2026-11-24 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR); follows #319 |
| Branch | `docs/runbook-quoted-port` (from `develop`) |
| Type / scope | `docs(repo)` |
| Files touched | `docs/infra/CUTOVER_RUNBOOK.md`, this entry. |
| Reserved files touched | None. |

**What was done.** Running the first pre-check of #319 against the real new server showed two mistakes in its command. The server's `.env` stores values in single quotes (`PORT='3251'`), so the port read for the local health check kept the quotes and the check printed nothing; it now strips them. The "Scheduled jobs" line is logged only once, at start-up, so the check no longer limits the search to the last 30 minutes. The corrected command was run on the real server: both services `active` and `{"status":"ok"}`.

**Also found in the same read-only run (no change needed):** the new server has no `api-new` in its `.env`; no SSM value names `api-new`; the jobs setting is a `SecureString` set to `false`; ports 80 and 443 are open to everyone and answer; the dry run of the Elastic IP move says it would succeed; the old instance's subnet gives a public address automatically; the new server's CPU credit balance is 288; both alarms are OK. The Caddyfile still names the test host, as the runbook expects.

**Database.** None. **Config and dependencies.** None. **Money impact.** None. **Tested.** The corrected command, on the real server. **Not tested.** The rest of the runbook, which first runs in the window.

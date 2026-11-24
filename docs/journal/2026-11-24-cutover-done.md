# Cutover done: production now runs on the new AWS server

| Field | Value |
|---|---|
| Date | 2026-11-24 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR); follows #319 and #320 |
| Branch | `docs/cutover-runbook-after-cutover` (from `develop`) |
| Type / scope | `docs(repo)` |
| Files touched | `docs/infra/CUTOVER_RUNBOOK.md`, this entry. |
| Reserved files touched | None. |

**What was done.** The cutover ran on Tuesday 24 November 2026 from 12:21 IST (12:51 AM US Central), following `docs/infra/CUTOVER_RUNBOOK.md`, after Jasil's written "go" at 12:16 IST and Jayasoorya's "start". `api.nasaroutes.com` now reaches the new `t4g.micro` server. No DNS record changed: the old server's Elastic IP, which the name already pointed at, was moved onto the new server.

**Timeline (IST, from the logs and CloudTrail).**

| Time | Event |
|---|---|
| 12:05:23 | Last request served by the old server. |
| 12:21:07 | Old app stopped (`pm2 stop`; the PM2 log shows the exit). |
| 12:21:38 | Old Elastic IP moved to the new instance (CloudTrail `AssociateAddress`). The spare IP detached by itself; the new instance kept a public address. |
| 12:22:26 | Caddy restarted with `api.nasaroutes.com`. Certificate obtained at 12:22:32. |
| 12:22:38 | First healthy `https://api.nasaroutes.com/healthz` from the new server. |
| 12:24:17 | First user request answered by the new server (an admin request). |
| 12:24 to 12:33 | Checks: admin sign-in, driver sign-in, dashboard, Insights connector (a data tool call ran through the new server), QuickBooks panel (connected, settings read). No `ERROR` lines. |
| 12:35:52 | `ReplaceUnhealthy` suspended on the Auto Scaling group. |
| 12:35:58 to 12:36:02 | Jobs switched on (SSM and `.env`), `nasa-backend` restarted: about 4 seconds down. Log: "Scheduled jobs are on". |
| 12:45 | First "Everee payments checked" on the new server (checked 2, not processed 2, the same as the old server's last run). |
| 13:15 | Next payment check logged, same result. |
| 13:16:49 | Old instance stopped (not terminated). |

**Downtime.** HTTPS to `api.nasaroutes.com` failed from 12:21:07 to 12:22:32, about 1 minute 25 seconds (first confirmed good response 12:22:38). No user request appears in either server's log inside that gap: the old server served nothing after 12:05:23 and the new server's first user request was at 12:24:17. A failed request does not reach an app log, so this shows that none was served, not that none failed. Nothing else interrupted service: the 12:36 restart was about 4 seconds and Caddy logged no upstream errors. Whether Everee tried a webhook during the gap is visible only in Everee's own delivery log.

**What differed from the runbook.**
- `systemctl reload caddy` failed on this server ("Job type reload is not applicable for unit caddy.service"). Caddy was restarted instead, which keeps its stored certificates. The runbook now says `restart`.
- The first pre-check read the port with its quotes (`PORT='3251'`); fixed in #320 before the window.
- The Everee payment job runs every 15 minutes, but an item is re-checked only when its last check is more than 15 minutes old, so with pending payments the "payments checked" line shows about every 30 minutes (12:45, 13:15), not every 15. The onboarding sync writes a line only when workers are in onboarding. The runbook watch section now says so.
- The old instance was stopped after the cutover (Jasil's decision, because PM2 is enabled at boot there and a reboot could have started a second job runner). Before that: termination protection on, a snapshot of its root disk, and a read-only check of its disk (no `uploads` folder, no cron jobs, only the `api` nginx site). The rollback order in the runbook now starts the old instance first.
- The one `Redis client error ... ECONNRESET` seen right after the move was a one-off, as on the first boot.

**Database.** None changed. A snapshot `nasa-pre-cutover-2026-11-24` was taken before the window. **Config and dependencies.** SSM `SCHEDULED_JOBS_ENABLED` is now `true`; the new server's Caddyfile has one hand edit (`api.nasaroutes.com`), which the Terraform follow-up replaces. **Money impact.** None. **Tested.** Everything above ran in the window. **Not tested.** The rollback, which has not been needed.

**Risks and follow-ups.** `ReplaceUnhealthy` stays suspended and the spare Elastic IP stays attached to nothing until the Terraform follow-up (import the old IP, release the spare, set `api_domain`, resume the process), which both owners read before applying. The old instance is deleted only after about 7 clean days and that follow-up. Check Everee's webhook delivery log for failures around 12:21 to 12:22. Later: rotate secrets, a dedicated database user for the app, narrower IAM.

# AWS infrastructure plan and Terraform foundation (proposal, nothing applied)

| Field | Value |
|---|---|
| Date | 2026-11-19 |
| Author | Jasil, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / not opened |
| Branch | `infra/aws-terraform-foundation` (from `develop`) |
| Type / scope | `chore(infra)` |
| Files touched | New only: `infra/terraform/` (VPC, NACLs, security groups, optional NAT and ALB, launch template, Auto Scaling group, IAM, release bucket, alarms, budget, `bootstrap/`, `tests/`), `infra/scripts/package-backend.sh`, `loadtest/` (script, mock, k6 version, README), `docs/infra/AWS_NETWORK_PLAN.md`, `docs/infra/AWS_COST_OPTIMISATION.md`, this entry. |
| Reserved files touched | None. No existing file was edited. |

**What and why.** The backend runs on one hand-deployed `t3.micro` in the default VPC. This adds a reviewable plan and Terraform to move it into its own VPC with an Auto Scaling group (1 instance), with the load balancer and NAT gateway written but **switched off** to keep the cost near $30 a month, plus a load test for 300 concurrent users and a cost and database plan.

**Database.** None changed. **Config and dependencies.** None in the app. Terraform and a load-test script are new tools; nothing is installed by the app.

**Money impact.** None to pay or Excel. Infrastructure cost: see `AWS_COST_OPTIMISATION.md` (figures from third-party sources, to be confirmed).

**Tested.** `terraform fmt`, `terraform validate` (main and bootstrap) and `terraform test` (3 plans on a mocked provider: default direct mode, ALB mode, ALB mode requesting its own certificate) all pass. The load-test script was run against a local mock server (300 users, 7,050 requests, 0 errors) and its production guard was checked.

**Not tested.** Any apply to a real AWS account; the instance bootstrap (never booted: Node 22 package name on Amazon Linux 2023 and the Caddy download are assumptions); a real load test of the backend (needs staging, test accounts and a raised rate limit); the arm64 build of `bcrypt`.

**Risks and follow-ups.** (1) The backend has no `/healthz`; the ALB cannot be turned on until it has one (`app.js` is Jayasoorya's area). (2) The in-process cron jobs mean `asg_max` must stay 1 until a single-runner lock is added. (3) The global limit of 1,000 requests per IP per 15 minutes (`app.js`) blocks a single-machine load test and may affect drivers sharing one Wi-Fi address: make it configurable and check real logs for `429`. (4) Open questions: region, where PostgreSQL runs, DNS location, which AWS account.

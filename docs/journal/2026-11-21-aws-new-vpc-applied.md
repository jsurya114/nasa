# New AWS VPC and server applied; production traffic not moved yet

| Field | Value |
|---|---|
| Date | 2026-11-21 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5); reviewed by Jasil |
| Issue / PR | none / pull request into `develop` (see the PR); follows #304, #309, #310, #312, #313, #315, #316 |
| Branch | `docs/journal-aws-new-vpc-applied` (from `develop`) |
| Type / scope | `docs(repo)` |
| Files touched | This entry only. |
| Reserved files touched | None. |

**What was done.** The Terraform stack in `docs/infra/terraform` was applied to the NASA AWS account (`us-east-1`) for the first time, in direct mode (no load balancer, no NAT gateway), after Jasil and Jayasoorya had both read the plan. Order, as Jasil's list required:
1. Backups: a manual RDS snapshot (`nasa-pre-vpc-move-2026-11-21`) and a snapshot of the old server's root volume.
2. The state bucket (bootstrap) already existed from earlier. Only the release bucket was applied first with `-target` (5 resources: bucket, public-access block, versioning, encryption, lifecycle).
3. A release of the backend, built from `main` with `docs/infra/scripts/package-backend.sh`, was uploaded to that bucket (`backend-<sha>.tgz` and `backend-latest.tgz`; checked: no `.env`, no `node_modules`, `/healthz` and `SCHEDULED_JOBS_ENABLED` present).
4. 44 settings were copied from the old server's `.env` into SSM Parameter Store under `/nasa/prod` with `docs/infra/scripts/copy-env-to-ssm.py` (43 standard, 1 advanced for the certificate chain; `SCHEDULED_JOBS_ENABLED=false`). The copy of the `.env` on the laptop was deleted afterwards.
5. Full apply: 69 added, 0 changed, 0 destroyed (the plan had been 74; 5 were already created). A normal plan right after said "No changes".

**What now exists.** A VPC `10.20.0.0/16` with public, app and data subnets in two zones, network ACLs, security groups (no SSH), an S3 gateway endpoint, a VPC peering connection to the default VPC (active, DNS resolution on both sides), one route in each VPC, one added rule on the existing database security group (5432 from the new app group), an Elastic IP, a launch template and an Auto Scaling group (1/1/1), one `t4g.micro` with unlimited CPU credits in `us-east-1a`, an instance role (SSM, no SSH), alarms, an alert topic with an email subscription (confirmed), and a $50 monthly budget. Nothing existing was changed, replaced or destroyed: the old server, the database, the old Elastic IP and the old security groups were not in the plan.

**What was checked on the new server** (through SSM, no SSH): the bootstrap log ends with "backend healthy" and "bootstrap finished" with no `render-env` error; `.env` is mode 600; the app log says "Scheduled jobs are off", "Database connected" (over the peering, the database name resolves to its private address) and "Server running"; `GET /healthz` returns ok; the app's own Redis client gets PONG; about 520 MB of 910 MB free.

**Not moved yet.** `api.nasaroutes.com` still points at the old server, which is unchanged and still runs the scheduled jobs. The new server is reachable only by its Elastic IP. Not done: the `api-new` DNS record and the read-only checks through it (DNS is at GoDaddy and Jayasoorya has no sign-in yet), the cutover, turning the jobs on for the new server, and the Insights and QuickBooks checks (their settings name `api.nasaroutes.com`).

**Database.** None changed. **Config and dependencies.** 44 SSM parameters under `/nasa/prod` (values are never in the repository). **Money impact.** None to pay or Excel. AWS cost after the move is expected near $36 a month before tax (today about $38.75); one week of both servers adds about $3.50 once; the one advanced SSM parameter is about $0.05 a month.

**Rollback.** Nothing moved, so nothing to roll back: do not change DNS. To remove the new stack, `terraform destroy` in `docs/infra/terraform` (the state bucket has `prevent_destroy` and stays). After the cutover, the rollback is the one in Jasil's plan: point DNS back, `pm2 start nasa-backend` on the old server, and set the jobs switch back to `false` on the new one.

**Not tested.** Real user traffic, the cutover, the Everee onboarding job running on the new server, and a browser or driver login against the new server.

**Risks and follow-ups.** (1) Both servers use the same production database and settings; the jobs must stay on only one of them. (2) The settings were pasted into a chat once during the copy; rotate the Everee, QuickBooks, database, Redis, Cloudinary and JWT secrets after the cutover is stable. (3) The temporary `AdministratorAccess` group used for the apply should be replaced by a narrower policy, and Jasil needs his own IAM sign-in with MFA. (4) The cutover steps, the rollback week and the cleanup list are in Jasil's plan in the Slack thread and in `docs/infra/AWS_NETWORK_PLAN.md` section 8.

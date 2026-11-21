# VPC peering to the default VPC, and a switch for the scheduled jobs (nothing applied)

| Field | Value |
|---|---|
| Date | 2026-11-21 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5), from Jasil's step list |
| Issue / PR | none / pull request into `develop` (see the PR) |
| Branch | `infra/vpc-peering-default-vpc` (from `develop`, after Jasil's PR #310 was merged) |
| Type / scope | `feat(repo)` |
| Files touched | `docs/infra/terraform/peering.tf` (new), `variables.tf`, `outputs.tf`, `tests/modes.tftest.hcl`, `README.md`, `Backend/app.js`, `Backend/.env.example`, this entry. |
| Reserved files touched | None. `Backend/app.js` is Jayasoorya's area. |

**What and why.** The production database stays in the default VPC (172.31.0.0/16) and the new server will live in 10.20.0.0/16, so the new VPC must reach it. `peering.tf`, behind `peer_default_vpc` (default `false`), adds only: one peering connection (auto-accepted, same account and region) with DNS resolution on both sides, a route to 172.31.0.0/16 in the new public table and in each app table, one route to 10.20.0.0/16 in the database's existing route table, and one TCP 5432 rule on the existing database security group, from the new `app` group, described "NASA new VPC backend". The existing route table, security group and VPC are read through data sources only. There is no resource that could take them over. `peer_db_security_group_id` (and optionally `peer_db_route_table_id`) go in the local `terraform.tfvars`, not in the repo.

`SCHEDULED_JOBS_ENABLED` in `Backend/app.js`: only the string `false` turns off the three scheduled jobs (hourly availability reset, Everee payment check every 15 minutes, Everee onboarding sync every 5 minutes). Unset keeps them on, so the current server behaves exactly as before. It stops the jobs running twice while two servers share one database. A database advisory lock per job is the lasting fix and is not part of this change.

**Database.** None. **Config and dependencies.** New optional backend setting `SCHEDULED_JOBS_ENABLED` (documented in `.env.example`). No new dependencies. New Terraform variables: `peer_default_vpc`, `peer_db_security_group_id`, `peer_db_route_table_id`.

**Money impact.** None to pay or Excel. A VPC peering connection has no hourly charge; data between the zones is the same availability zone, so no extra transfer cost is expected (to be confirmed on the first bill).

**Tested.** `terraform fmt`, `terraform validate` and `terraform test` (10 runs on a mocked provider, including peering off, peering on, and peering without a database security group, which is refused). `node --check Backend/app.js`.

**Not tested.** Any plan or apply against the real AWS account (the login session had expired when this was written), the route table the database's subnets really use, the cross-VPC security group rule on a real peering, DNS resolution of the RDS endpoint over the peering, and the app with `SCHEDULED_JOBS_ENABLED=false` on a running server.

**Risks and follow-ups.** (1) The plan must show every existing resource untouched and these additions as "create" only: read it before any apply. (2) If the database's subnets use a custom route table, set `peer_db_route_table_id`. (3) The jobs switch must be `false` on the new server until the old one is stopped, then `true`.

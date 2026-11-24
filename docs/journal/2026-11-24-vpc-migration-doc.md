# Document the whole move to the new AWS network

| Field | Value |
|---|---|
| Date | 2026-11-24 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5); requested by Jasil |
| Issue / PR | none / pull request into `develop` (see the PR); follows #321 |
| Branch | `docs/vpc-migration-doc` (from `develop`) |
| Type / scope | `docs(repo)` |
| Files touched | `docs/infra/VPC_MIGRATION.md` (new), `docs/infra/terraform/README.md` and `docs/infra/AWS_NETWORK_PLAN.md` (status lines and a link only), this entry. |
| Reserved files touched | None. |

**What was done.** One document, `docs/infra/VPC_MIGRATION.md`, that lets someone new understand the setup and run the move again from that page and the files it links. It covers: the old setup and what was wrong with it; the new setup with a side-by-side diagram, the request path from a user to the server and the database and back, and every part; why each decision was made, with the load-test evidence and the cost before and after; how it was done in order (the staging load test, PRs #309 to #321, the settings copy, the bucket-first apply, the pre-checks and the cutover with each step's time and result, and what differed from the plan); the rollback order and when it stops being possible; the checklist of what is next, with proposed owners; and operations (deploy a release, change a setting, read logs through Session Manager, what each alarm means). Section 8, "Technologies used", was added at Jasil's request: each technology with what it is used for and its version where it matters, old against new where they differ. Versions were read from the code, the lock file and the running server (Terraform 1.17.2 and AWS provider 6.73.0, Node.js 22, npm 10, Caddy 2.10, `dotenv` 17, Amazon Linux 2023, PostgreSQL 17.9). Corrections to the list Jasil sent: CloudTrail is not configured by us (the account's event history was used to read the IP move time), and no customer KMS key is set (SecureString and the disk use AWS's managed keys; the buckets use S3's own encryption). The old server's Node, nginx, certbot and PM2 versions are marked "not recorded" because it was stopped before they were written down. The final downtime figure is in it: about 1 minute 25 seconds, from 12:21:07 to 12:22:32 IST on 24 November 2026.

The Terraform README and the network plan said "production not applied". Their status lines now say it was applied on 2026-11-21 and the traffic moved on 2026-11-24, and point to the new page. Nothing else in them changed.

**Public repository check.** The page has no account number, IP address, or instance, volume or snapshot ID (checked by searching the file). It uses names and roles. The existing private ranges `10.20.0.0/16` and `172.31.0.0/16` are the ones already in the plan.

**Facts checked against the code and the record.** Subnets, security groups, the instance role, alarms and the bootstrap order against the Terraform files; the PR list against GitHub; the cutover times against the new server's log, CloudTrail and the old server's PM2 log; the cost lines against `AWS_COST_OPTIMISATION.md`. That page's October table lists lines that add to $41.31, not the $38.75 it states, so the new page gives the $38.75 total and the new components, not that table. **Not verified:** the interim in-place deploy route in section 7 has not been used (the page says so); the owners in section 6 are proposals.

**Database.** None. **Config and dependencies.** None. **Money impact.** None. **Tested.** Nothing runs; every command in the page was run in the cutover or is the same kind as one that was. **Not tested.** The rollback and the in-place deploy.

**Risks and follow-ups.** The page names a trap: until the Terraform follow-up is applied, a replaced instance would take the spare Elastic IP and serve the test name. Keep that line current when the follow-up is applied, and update the status of the checklist items as they close.

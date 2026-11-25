# A private bucket for the logs saved before the recovery drill (plan only)

| Field | Value |
|---|---|
| Date | 2026-11-25 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR) |
| Branch | `infra/drill-log-bucket` (from `develop`) |
| Type / scope | `chore(repo)` (Terraform and docs) |
| Files touched | `docs/infra/terraform/` (`drill_logs.tf` new, `variables.tf`, `outputs.tf`, `tests/modes.tftest.hcl`), `docs/infra/DRILL_LOG_SAVE.md` (new), `docs/infra/VPC_MIGRATION.md` (one table row), this entry. |
| Reserved files touched | None. |

**What and why.** Jasil's conditions for the recovery drill: the app and Caddy logs live only in the server's journal, and the drill deletes them, so one compressed copy is saved first. This adds the place for it: a separate private bucket (production only), public access fully blocked, encrypted, encrypted connections only, and a lifecycle rule that deletes the file 35 days after upload (variable `drill_log_retention_days`, 7 to 90; set to about 30 days after the old server is deleted once that date is fixed). The server has no access to it. A person uploads through a pre-signed PUT link that expires within 15 minutes (`DRILL_LOG_SAVE.md` has the commands, the checks and what to record).

**Nothing is applied.** A real `terraform plan` against production says `5 to add, 0 to change, 0 to destroy` (the bucket, its public-access block, encryption, lifecycle rule and TLS-only policy). No existing resource changes. Applying needs both owners to have read the plan, as before.

**Database.** None. **Config and dependencies.** One new Terraform variable and one output; no application change. **Money impact.** None to pay. AWS cost: a few MB in S3 for about five weeks, well under a cent.

**Tested.** `terraform fmt -check`, `terraform validate`, `terraform test` (16 passed: three new, for the bucket, the bounded retention and no bucket in staging, with the local `terraform.tfvars` moved aside), and the plan above. **Not tested:** the upload commands in `DRILL_LOG_SAVE.md` (the bucket does not exist yet), including the pre-signed link step; test it with a small dummy file right after the apply.

**Risks and follow-ups.** A file saved by mistake with a secret in it would sit there until it expires; the logs are not supposed to hold any. Follow-up, its own pull request after the drill (Jasil): CloudWatch logs with 14 days' retention, with the cost in the PR.

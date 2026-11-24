# Terraform: raise the minimum version to 1.11 and fix a variable description

| Field | Value |
|---|---|
| Date | 2026-11-25 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR); follows #326 |
| Branch | `chore/terraform-nits-after-adoption` (from `develop`) |
| Type / scope | `chore(repo)` (Terraform) |
| Files touched | `docs/infra/terraform/versions.tf`, `docs/infra/terraform/variables.tf`, `docs/infra/VPC_MIGRATION.md` (one table row), this entry. |
| Reserved files touched | None. |

**Why.** Jasil's two non-blocking notes on #326.
1. The description of `existing_eip_allocation_id` still said Terraform adopts the address "with an import block", which #326 removed. It now says the address was imported once (the production follow-up of 24 November 2026) and that dropping the variable makes the plan fail on purpose (`prevent_destroy`), so it must stay set.
2. `tests/modes.tftest.hcl` now uses `override_during`, which needs Terraform 1.11 or newer (HashiCorp's 1.11 release notes), while `required_version` said `>= 1.10`. Plan and apply would still work on 1.10, but `terraform test` would fail there. `required_version` in `versions.tf` is now `>= 1.11`, with a comment on why: 1.10 for the S3 state lock, 1.11 for the test override. The Terraform row in `VPC_MIGRATION.md` says the same. The bootstrap stack (`bootstrap/main.tf`) has no tests and stays at `>= 1.10`.

**Effect.** None in AWS. The stack is applied with 1.17.2, so nobody on the team is affected by the higher minimum; only someone on 1.10 would now be told to upgrade.

**Checks run.** `terraform fmt -check`, `terraform validate`, `terraform test` (13 passed, with the local `terraform.tfvars` moved aside), and a real `terraform plan` against production: "No changes".

**Database.** None. **Config and dependencies.** The Terraform minimum version only. **Money impact.** None. **Tested.** As above. **Not tested.** Terraform 1.10 and 1.11 themselves (only 1.17.2 was run); the 1.11 requirement comes from HashiCorp's release notes.

**Risks and follow-ups.** None. The rollback week, the recovery drill decision and the secret rotation are unchanged.

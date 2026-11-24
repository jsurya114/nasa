# Terraform follow-up: adopt the old Elastic IP (plan only, not applied)

| Field | Value |
|---|---|
| Date | 2026-11-24 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR); follows #321 and #322 |
| Branch | `infra/adopt-api-elastic-ip` (from `develop`) |
| Type / scope | `chore(repo)` (Terraform) |
| Files touched | `docs/infra/terraform/` (`variables.tf`, `compute.tf`, `iam_storage.tf`, `outputs.tf`, `terraform.tfvars.example`, `tests/modes.tftest.hcl`, `README.md`), `docs/infra/CUTOVER_RUNBOOK.md` (section 6, item 1), this entry. |
| Reserved files touched | None. |

**Why.** After the cutover, production serves `api.nasaroutes.com` on the old Elastic IP, which was made by hand and which Terraform does not know. Terraform still owns the spare address, which nothing uses. Until Terraform owns the address in DNS, a replaced instance would take the spare one, and `ReplaceUnhealthy` stays suspended by hand. This is the follow-up that Jasil and Jayasoorya agreed to read before applying.

**What the code change does.** A new variable `existing_eip_allocation_id` (default empty, checked to look like `eipalloc-...`). When it is empty nothing changes: one Elastic IP is created, as before (staging and any new setup). When it is set, Terraform imports that address into a new resource `aws_eip.api` (with `prevent_destroy`, because it is the address in DNS) through an `import` block, creates no second address, and the boot script, the instance's permission to attach its own address and the `api_ip_for_dns` output all read the adopted one. The old resource `aws_eip.direct` is then not wanted, so its address (the spare) is released. `api_domain` needs no change in the code: its default is already `api.nasaroutes.com`. Only the local `terraform.tfvars` overrode it with the test name.

**Checks run.** `terraform fmt`, `terraform validate`, and `terraform test`: 13 passed (the 11 existing plus 2 new: an existing address is adopted and none is created beside it, and a malformed ID is refused). The tests need an empty `terraform.tfvars` (run them with the local one moved aside), as before.

**The plan** (read-only, against the real production state, `terraform plan -var-file=followup.tfvars` with `api_domain = "api.nasaroutes.com"` and `existing_eip_allocation_id` set to the old address; nothing applied):

> Plan: 1 to import, 0 to add, 4 to change, 1 to destroy.

| # | What | Meaning |
|---|---|---|
| 1 | `aws_eip.api["api"]` imported, updated in place | The old Elastic IP. Only its tags change (`Name`, `Project`, `Environment`, `ManagedBy`). It stays attached to the running server; the address does not move or change. |
| 2 | `aws_eip.direct[0]` destroyed | The spare address, unattached. Releasing it stops its charge (about $3.65 a month). Nothing points at it: no `api-new` DNS record exists and no allow-list names it. This one step cannot be undone (a new spare would have a different address), which is fine because nothing uses it. |
| 3 | `aws_iam_role_policy.app` updated in place | The instance's permission to attach its own Elastic IP now names the old address instead of the spare. |
| 4 | `aws_launch_template.app` updated in place | A new template version: the boot script now carries the old address's allocation ID. Its `api_domain` was already right in the running server by the hand edit, so no behaviour changes there. |
| 5 | `aws_autoscaling_group.app` updated in place | Only `suspended_processes`: `ReplaceUnhealthy` is removed from the suspended list, that is, resumed. |
| Output | `api_ip_for_dns` | Changes from the spare's address to the old address. |

The redacted plan (account number, addresses and IDs replaced by placeholders) was shared with Jasil in the Slack thread.

**What the plan cannot show: an instance refresh.** The group has an `instance_refresh` (terminate, then launch) and uses the launch template's `$Latest` version. Terraform starts a refresh when the group's own settings change, and `$Latest` does not change when only the template gets a new version, so the new version should not replace the running instance. This is *not verified*: it depends on provider behaviour and only the apply shows it. The earlier runbook text said the apply would replace the instance; that was an assumption. Plan for the worse case: a refresh would take the server down for a few minutes, with the jobs still on one server only, because it terminates before it launches.

**Apply steps (for the quiet window, only after both have read the plan).**
1. Merge this pull request. In the local `terraform.tfvars`: delete the `api_domain = "api-new..."` line and add `existing_eip_allocation_id = "<old allocation ID>"` (from `~/cutover-ids.env`, `OLD_ALLOC`). Keep it there permanently: without it the next plan would recreate a spare address and drop the adopted one.
2. A fresh `terraform plan -out`: it must still read "1 to import, 0 to add, 4 to change, 1 to destroy", with the same five changes. The state bucket is versioned, so the previous state is recoverable.
3. The usual pre-checks: both services active, `/healthz` ok, the quiet check, Jasil's "go".
4. `terraform apply <plan file>`. Then at once: `aws autoscaling describe-instance-refreshes` (is one running?) and `/healthz`.
5. Check: `terraform plan` says "No changes"; the group's `SuspendedProcesses` is empty; the old address is still on the same instance; the spare is gone (`describe-addresses` for it returns not found); `https://api.nasaroutes.com/healthz` ok; Caddyfile unchanged.
6. Optional, with its own go: a recovery drill, `aws autoscaling start-instance-refresh`, to prove that a replacement comes up correctly (release from the bucket, settings from SSM, the old address, a certificate for `api.nasaroutes.com`) while the old instance is still available for rollback. It costs a few minutes down, so only in a quiet window.

**Rollback of the follow-up.** Nothing here moves or releases the address in DNS. If the apply goes wrong: re-suspend the process (`aws autoscaling suspend-processes ... --scaling-processes ReplaceUnhealthy`), and the state can be restored from the bucket's previous version. The only step that cannot be undone is releasing the unused spare. If a refresh starts and the new instance does not come up, follow `CUTOVER_RUNBOOK.md` section 5 (recovery) and section 4 (rollback).

**Database.** None. **Config and dependencies.** One new Terraform variable. No application change. **Money impact.** None to pay or Excel; AWS cost falls by about $3.65 a month when the spare is released. **Tested.** The Terraform tests (13) and a real read-only plan. **Not tested.** The apply, and whether a refresh starts.

**Risks and follow-ups.** Any apply, even an unrelated one, now resumes `ReplaceUnhealthy`; do not apply anything else before this one. After a clean apply the `import` block can be removed in a later pull request (it does nothing once the address is in the state). Update `VPC_MIGRATION.md` section 6 when it is done.

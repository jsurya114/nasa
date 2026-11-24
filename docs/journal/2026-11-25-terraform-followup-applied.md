# Terraform follow-up applied: the old Elastic IP is now in Terraform

| Field | Value |
|---|---|
| Date | 2026-11-25 (the apply ran on 2026-11-24 at 23:46 IST) |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR); follows #325 |
| Branch | `infra/after-eip-adoption` (from `develop`) |
| Type / scope | `chore(repo)` (Terraform and docs) |
| Files touched | `docs/infra/terraform/` (`compute.tf`, `terraform.tfvars.example`, `tests/modes.tftest.hcl`, `README.md`), `docs/infra/CUTOVER_RUNBOOK.md`, `docs/infra/VPC_MIGRATION.md`, this entry. |
| Reserved files touched | None. |

**What happened in AWS (the apply).** The plan reviewed in #325 was applied once, after both owners had read it and Jasil had agreed the window (Jayasoorya relayed Jasil's "go" from a call; Jasil's written approval of the plan and the checklist is in the Slack thread). It ran earlier than the agreed 12:00 IST window, at the start of a 15-minute gap between scheduled jobs, so the Everee check at 23:45 IST had just run.

| Time (IST) | Step |
|---|---|
| 23:31 | Fresh `terraform plan -out`: 1 to import, 0 to add, 4 to change, 1 to destroy, nothing "must be replaced". |
| 23:45 | The Everee payment check logged normally (2 checked, `not_processed` 2). |
| 23:46:29 to 23:46:52 | `terraform apply` of the saved plan: `Apply complete! Resources: 1 imported, 0 added, 4 changed, 1 destroyed.` |
| 23:47 | Checks, below. |
| 23:47 to 00:16 | Watch every 4 minutes. |

**Result: no instance refresh, no downtime.**
- `describe-instance-refreshes`: none. The group's launch template setting (`$Latest`) does not change when the template gets a new version, so no refresh started, as Jasil and Jayasoorya expected. That was not known before the apply.
- `/healthz` ok at every check. The group has one instance, InService and Healthy, with the same launch time as before (21 November): the instance was not replaced.
- The old Elastic IP is on that instance and the address is unchanged; `api.nasaroutes.com` resolves to it.
- `ReplaceUnhealthy` is resumed (the suspended list is empty).
- The spare address is released: one Elastic IP is left in the account.
- The second `terraform plan` said "No changes".
- During the 30-minute watch: both alarms OK, `nasa-backend` and `caddy` active, 0 ERROR lines, and the Everee check at 00:15 IST logged normally (2 checked, `not_processed` 2).

**What this pull request changes.**
- Removes the `import` block from `compute.tf`. It did its job; the address is in the state. With it removed, a real plan against production still says "No changes".
- The adoption test no longer gets the address from the import, so its override now sets `override_during = plan`. `terraform test`: 13 passed.
- Fixes the pointer in `terraform.tfvars.example` (it now points to the journal entry, as the README and runbook do; Jasil's nit on #325), and adds that the variable must stay set.
- Updates `VPC_MIGRATION.md` (section 6 item 2 done, costs, deploy, alarms, health checks, component tables), `CUTOVER_RUNBOOK.md` (section 4 step 5, section 5, section 6 items 1 and 2) and the Terraform README so they say what is now true: no spare address, `ReplaceUnhealthy` on, the follow-up applied.

**Not proven.** That a *replaced* instance comes up correctly with the new startup script (release from the bucket, settings from SSM, the old address, a certificate for `api.nasaroutes.com`). The first real instance refresh, or a deliberate recovery drill in its own quiet window, will show it. Jasil asked to decide on the drill afterwards.

**Rollback of the apply.** Nothing was released that is in use. The only step that cannot be undone, releasing the unused spare address, is done and harmless: nothing pointed at it.

**Database.** None. **Config and dependencies.** None changed in the code beyond removing the `import` block; the local `terraform.tfvars` keeps `existing_eip_allocation_id`. **Money impact.** None to pay or Excel; AWS cost falls by about $3.65 a month (the spare address).

**Tested.** `terraform fmt`, `validate`, `terraform test` (13 passed, run with the local `terraform.tfvars` moved aside), and a real `terraform plan` against production after removing the `import` block: "No changes". **Not tested.** An instance replacement (see above).

**Risks and follow-ups.** Keep `existing_eip_allocation_id` in the local `terraform.tfvars`: if it is dropped, `prevent_destroy` makes the plan fail on purpose. Delete the local `followup.tfvars`. Rollback week continues; the old server is still stopped.

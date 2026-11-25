# Server template: no core dump on a crash, swap used only under pressure

| Field | Value |
|---|---|
| Date | 2026-11-25 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` |
| Branch | `chore/server-no-core-dump-swap` (from `develop`) |
| Type / scope | `chore(repo)` |
| Files touched | `docs/infra/terraform/user_data.sh.tpl`, `docs/infra/terraform/terraform.tfvars.example`, `docs/infra/terraform/tests/modes.tftest.hcl`, this entry. |
| Reserved files touched | None. |

**What and why.** Two weekly uploads (24 Nov 22:09 UTC and 25 Nov 09:33 UTC) ran the backend out of memory (heap limit 384 MB). Both times the service then stayed down for exactly 5 minutes between the "out of memory" line and the process exit; systemd restarts in 3 s, so the 5 minutes are the crash dump (the unit has `LimitCORE=infinity`; the dump is not kept). This change, as Jasil decided on 2026-11-25:
- The service unit gets `LimitCORE=0`: a crash then costs about 3 s, not 5 minutes. (Not proven that this removes the 5 minutes; it is checked on the server after the change.)
- When `swap_mb > 0`, the template sets `vm.swappiness=10` (a sysctl file) so swap is used only under real memory pressure. The swap file itself was already in the template (`swap_mb`, default 0).
- `terraform.tfvars.example` now shows `swap_mb = 2048` and `node_heap_mb = 768` (needs the swap) with the reason, so a replacement server built from it carries both. The real `terraform.tfvars` is not in the repository.
- A new test checks that the rendered template has `LimitCORE=0`, the 2 GiB swap commands, `vm.swappiness=10` and the heap value.

The live server is changed by hand with the same settings, only after Jasil and Jayasoorya both say "go" on the exact commands (see the Slack thread). **Do not run `terraform apply` for this before the recovery drill**: the apply only writes a new launch-template version, but it must not roll the running server.

**Database.** None. **Dependencies.** None. **Money impact.** None.

**Tested.** `terraform test` (the local `terraform.tfvars` set aside, because it adopts the existing Elastic IP and so changes two older assertions): 17 passed, 0 failed (16 existing + 1 new). **Not tested:** a real server built from the template (that is the Friday drill); that `LimitCORE=0` removes the 5-minute stall (checked on the live server after the hand change).

**Risks and follow-ups.** With a 768 MB heap on a 910 MB server the app can use swap during a big upload, so the upload gets slower instead of crashing. Remove the 768 MB / swap lines again once the upload reads the file row by row.

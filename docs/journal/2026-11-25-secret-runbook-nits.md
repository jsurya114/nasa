# Secret rotation runbook: wording and two small fixes (Jasil's notes on #328)

| Field | Value |
|---|---|
| Date | 2026-11-25 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR); follows #328 |
| Branch | `docs/secret-runbook-nits` (from `develop`) |
| Type / scope | `docs(repo)` (infrastructure) |
| Files touched | `docs/infra/SECRET_ROTATION_RUNBOOK.md`, `docs/infra/scripts/rerender-env.sh`, this entry. |
| Reserved files touched | None. |

**Why.** Three non-blocking notes from Jasil's review of #328.
1. **Public wording.** The repository is public. The runbook opened by saying that every production value was exposed and would stay unrotated until after the rollback week, which tells a reader when the window is open. `ENGINEERING_STANDARD.md` section 5 says to describe a fix by what it now protects. The runbook's opening now says it is routine rotation after the move, so that every copy made before the move stops working. The section about timing says why it waits for the old server's deletion (the old server is the rollback copy) and no longer says why else. Rule 4 now says "the old value", not "the exposed value".
2. **`rerender-env.sh`, no `PORT=` line.** Under `pipefail` the script used to exit silently. It now stops with a clear message and changes nothing.
3. **Step C, process list.** `--value "$VALUE"` keeps the value out of shell history but shows it in the local process list for a moment. Step C and the undo step now write the value to a mode-600 temporary file and pass `--value file://...`, then delete the file. A value that is generated is written without a trailing newline.

**Not edited, on purpose.** Journal entries are never edited, so the wording that this entry replaces remains in `docs/journal/2026-11-25-secret-rotation-runbook.md`, and an older entry (`2026-11-21-aws-new-vpc-applied.md`) says the settings were once pasted into a chat. If the owners want those lines reworded, they decide it; this entry does not do it. The description of #328 was reworded.

**Tested (25 November 2026).**
- The `file://` form, on a throwaway SSM parameter outside `/nasa/prod` (deleted afterwards): a generated 48-byte hex value is stored with exactly 96 characters and no trailing newline, and a typed value is stored unchanged. Nothing was printed.
- The script, on the production server through SSM: `bash -n` passes; the normal dry run is unchanged (it names only `SCHEDULED_JOBS_ENABLED`, changes nothing); with an `.env` that has no `PORT=` line (a temporary copy in `/tmp`, removed afterwards) it prints "ERROR: no PORT= line ... Nothing was changed." and exits 1.
- **Not tested:** `--apply`, and the provider-side steps, as before.

**Database.** None. **Config and dependencies.** None. **Money impact.** None. Merging changes nothing in AWS and no secret is rotated.

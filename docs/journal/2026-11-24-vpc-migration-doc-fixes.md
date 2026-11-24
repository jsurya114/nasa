# Migration doc: fixes from Jasil's review of #322

| Field | Value |
|---|---|
| Date | 2026-11-24 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5); review notes by Jasil |
| Issue / PR | none / pull request into `develop` (see the PR); follows #322 |
| Branch | `docs/vpc-migration-doc-fixes` (from `develop`) |
| Type / scope | `docs(repo)` |
| Files touched | `docs/infra/VPC_MIGRATION.md`, this entry. |
| Reserved files touched | None. |

**What was done.** Three fixes to `docs/infra/VPC_MIGRATION.md`, from Jasil's review of #322:
1. Section 6, item 4: the sentence about secrets now reads "rotate the other secrets after the move, as planned", without saying how they were handled.
2. Section 7, "Change a setting": the example no longer puts the value in the shell history (`read -rs VALUE`, then `--value "$VALUE"`, or a temporary file that is deleted). It also says a value over 4 KB, such as the database certificate chain, needs `--tier Advanced`, and that the `.env` is edited in an editor in a Session Manager shell, not with a command that contains the value.
3. Section 7, interim deploy: it no longer unpacks over `/opt/nasa/Backend`. It unpacks into a new folder, runs `npm ci --omit=dev` there, copies `.env` (mode 600, owned by the service user), swaps the folders, restarts, and keeps the old folder for a quick revert. It also says to apply the Terraform follow-up before the first deploy and to use this route only for an urgent fix.

**A correction to the entry for #322** (`2026-11-24-vpc-migration-doc.md`, which is not edited): it says the October table in `AWS_COST_OPTIMISATION.md` lists lines that do not add up to the $38.75 total. That was wrong. Those lines include tax and add up to $41.31, October's total with tax, so both figures are right. The migration page was already comparing like with like ($38.75 before tax). Jasil will fix the label of that table.

**Database.** None. **Config and dependencies.** None. **Money impact.** None. **Tested.** Read again against the review notes; no identifier or address in the changed text. **Not tested.** The interim deploy route, which has still not been used.

**Risks and follow-ups.** The page still says the first use of the interim deploy needs the other owner's agreement. Rotating the secrets is tracked in section 6, item 4.

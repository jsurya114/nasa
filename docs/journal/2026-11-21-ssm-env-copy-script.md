# Script to copy the backend settings into SSM Parameter Store (nothing applied)

| Field | Value |
|---|---|
| Date | 2026-11-21 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR) |
| Branch | `infra/ssm-env-copy-script` (from `develop`) |
| Type / scope | `chore(repo)` |
| Files touched | New: `docs/infra/scripts/copy-env-to-ssm.py`, this entry. Edited: `docs/infra/terraform/README.md` (one line in the first-apply steps). |
| Reserved files touched | None. |

**What and why.** The new server reads its backend settings from SSM Parameter Store under `/nasa/prod/*`, one SecureString per setting. The values must never be pasted into chat, a ticket or the repository, so this script reads a copy of the old server's `.env` and sends each value straight to AWS. It writes nothing unless `--apply` is given (the default prints the setting names and value lengths only, never a value). It skips `NODE_ENV`, `PORT` and `TRUST_PROXY` (the server's setup script writes those), forces `SCHEDULED_JOBS_ENABLED=false` (the new server must not run the scheduled jobs while the old one still does), skips empty values, refuses values with a line break or over 4 KB, and never replaces an existing parameter unless `--overwrite` is given. Values go through a private temporary file that is removed straight after each write, never through a command line.

**Database.** None. **Config and dependencies.** None in the app. Python 3 and the AWS CLI are needed where the script runs; no packages are installed.

**Money impact.** None. Standard SSM parameters have no charge.

**Tested.** Run against the real NASA account with a fake `.env` of dummy values under a throwaway path: the dry run wrote nothing; `--apply` created SecureString parameters, forced the jobs switch to `false`, skipped the three bootstrap settings and the empty one; a second run without `--overwrite` replaced nothing; with `--overwrite` it did; no temporary file was left behind. The throwaway parameters were deleted afterwards (0 remain).

**Not tested.** A run with the real `.env` (done by Jayasoorya, who keeps the values private), and a setting whose value contains `=`, quotes or `#` in unusual positions beyond the simple forms the script handles.

**Risks and follow-ups.** (1) The script needs AWS credentials for the NASA account where it runs, so run it on a machine that has them, using a copy of the `.env` that is deleted straight after. (2) Check the dry-run list against the old `.env` before `--apply`. (3) After cutover, set `/nasa/prod/SCHEDULED_JOBS_ENABLED` to `true` (see the migration steps).

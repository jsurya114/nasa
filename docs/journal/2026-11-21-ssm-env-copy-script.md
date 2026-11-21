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

**What and why.** The new server reads its backend settings from SSM Parameter Store under `/nasa/prod/*`, one SecureString per setting. The values must never be pasted into chat, a ticket or the repository, so this script reads a copy of the old server's `.env` and sends each value straight to AWS. It writes nothing unless `--apply` is given (the default prints the setting names and value lengths only, never a value). It reads the file with the backend's own `dotenv` (from `Backend/node_modules`), so each value is exactly what the old server's app sees (quotes, `\n` inside double quotes, inline `#` comments). Before writing, every setting goes through a round trip: the line the server's bootstrap writes (`NAME=` plus the value as JSON) is parsed with the same `dotenv`, and any setting that would come back different is refused by name only; with `--apply` nothing at all is written until none is refused, so the copy is complete or absent. It skips `NODE_ENV`, `PORT` and `TRUST_PROXY` (the bootstrap writes those), forces `SCHEDULED_JOBS_ENABLED=false` (the new server must not run the scheduled jobs while the old one still does), skips empty values, allows line breaks (marked in the list, for a PEM key or certificate), refuses values over 4 KB, and never replaces an existing parameter unless `--overwrite` is given. Values go through a private temporary file that is removed straight after each write, never through a command line.

**Review fix (Jasil, #312).** The first version used its own parser, which ignored inline comments and `\n` in double quotes, so a PEM or a value followed by a comment would have arrived changed. It now uses the app's parser and the round trip above. A value containing a backslash or a double quote is refused until the bootstrap's `@json` line is made dotenv-safe (Jasil's separate change).

**Database.** None. **Config and dependencies.** None in the app. Python 3, the AWS CLI and Node with `Backend/node_modules` (`npm ci` in `Backend`) are needed where the script runs; no packages are installed by it.

**Money impact.** None. Standard SSM parameters have no charge.

**Tested.** Run against the real NASA account with dummy values under a throwaway path. Jasil's cases through the real `dotenv` 17.2.2: a plain value, a double-quoted PEM with `\n`, `value # comment`, `"value" # note` and `export KEY="..."` are copied exactly (the PEM read back from SSM has its real line breaks; the comment is not part of the value); `ab\cd` and `'say "hi"'` are refused by name. With a refused setting, `--apply` exits with an error and writes nothing (0 parameters under the test path). A second run without `--overwrite` replaced nothing. No temporary file was left behind. The throwaway parameters were deleted.

**Not tested.** A run with the real `.env` (done by Jayasoorya, who keeps the values private); non-ASCII values.

**Risks and follow-ups.** (1) The script needs AWS credentials for the NASA account where it runs, so run it on a machine that has them, using a copy of the `.env` that is deleted straight after. (2) Check the dry-run list against the old `.env` before `--apply`. (3) After cutover, set `/nasa/prod/SCHEDULED_JOBS_ENABLED` to `true` (see the migration steps).

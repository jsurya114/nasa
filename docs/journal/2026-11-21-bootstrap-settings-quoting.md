# The new server's settings reach the app exactly as stored

| Field | Value |
|---|---|
| Date | 2026-11-21 |
| Author | Jasil, with Claude Code (Claude Opus 5.5) |
| Issue / PR | none / this PR |
| Branch | `fix/bootstrap-env-quoting` (from `develop`) |
| Type / scope | `fix(repo)` |
| Files touched | `docs/infra/terraform/user_data.sh.tpl` (production settings step), `docs/infra/terraform/compute.tf` (one template variable), new `docs/infra/terraform/render-env.cjs`, new `docs/infra/terraform/tests/render-env.test.cjs`, `docs/infra/terraform/tests/modes.tftest.hcl` (two checks), `docs/infra/terraform/README.md`, this entry. |
| Reserved files touched | None. |

**What and why.** On a production instance, the bootstrap wrote each SSM setting as `NAME="<JSON string>"`. dotenv, which the app uses to read `.env`, removes the outer quotes and turns `\n` into a line break, but never unescapes `\\` or `\"`. So any value with a backslash or a double quote reached the app changed, for example a password or a key, and a value with a literal `\n` gained a backslash. This was found while reviewing PR #312 (the script that copies the old `.env` into SSM).

Now `render-env.cjs`, embedded in the bootstrap and run with the release's own dotenv, puts each value in the first quote style dotenv returns unchanged for it: single quotes, then double, then backticks. It parses the whole file back with dotenv and compares every value. If a setting can't be carried (a carriage return, a trailing backslash, or all three quote characters), the bootstrap stops before the app starts. It names the setting, never the value, and removes the partial file. Line breaks now work (for example a PEM certificate), so the README no longer forbids them. If SSM also holds `NODE_ENV`, `PORT` or `TRUST_PROXY`, the bootstrap's own values win, and the ignored names are logged.

**Database.** None. **Config and dependencies.** None. It uses the dotenv already in the release.

**Money impact.** None.

**Tested.**
- `node --test docs/infra/terraform/tests/render-env.test.cjs`, with the backend's dotenv 17.2.2: 5 tests pass. Fifteen awkward values (PEM, backslashes, both quote kinds, `#`, `$`, spaces, unicode, JSON) come back identical, and values it can't carry are refused by name.
- `terraform fmt`, `validate` and `test`: 11 runs pass. The production run now also checks that the renderer is used and that user data stays under 16 KB.
- The rendered production settings step was run locally with a stand-in for the AWS command. The values came back identical, the file is `0600`, and the temporary file was removed. A refused value stopped the step and removed the partial file.

**Not tested.** A real instance boot with this change, and real SSM values. The staging branch of the bootstrap still writes its two generated values (`DB_PASSWORD` and the RDS CA) as JSON strings. The CA has no backslash or quote, so it is unaffected. An RDS-managed password could in principle contain a backslash, which matters for staging only.

**Risks and follow-ups.** PR #312's copy script should read the old `.env` with the same dotenv, so the values sent to SSM are the ones the old server actually uses (asked for in the review).

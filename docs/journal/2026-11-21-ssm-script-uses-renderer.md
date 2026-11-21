# SSM copy script now checks values with the server's own renderer (nothing applied)

| Field | Value |
|---|---|
| Date | 2026-11-21 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR); follows #312 and #313 |
| Branch | `infra/ssm-script-use-renderer` (from `develop`) |
| Type / scope | `chore(repo)` |
| Files touched | `docs/infra/scripts/copy-env-to-ssm.py`, this entry. |
| Reserved files touched | None. |

**What and why.** #312 checked each value with its own round trip (render as JSON, parse back), which was stricter than the server: it refused any value holding a backslash or a double quote. #313 added `render-env.cjs`, which the server's bootstrap runs at boot and which carries those values. So the script and the boot could disagree. The script now runs `terraform/render-env.cjs` itself (`settingsFrom` and `render`, with the backend's `dotenv`) and refuses exactly what the bootstrap would stop on: a carriage return, a trailing backslash, a value with all three quote characters, an invalid setting name. With `--apply` nothing is written while any setting is refused. Everything else in the script is unchanged (dry run by default, names only, forced `SCHEDULED_JOBS_ENABLED=false`, no overwrite without `--overwrite`).

**Database.** None. **Config and dependencies.** None. The script needs the repository checkout (it reads `render-env.cjs`), Node and `Backend/node_modules`.

**Money impact.** None.

**Tested.** Dry run and a real write to a throwaway SSM path with dummy values: `ab\cd`, `say "hi"`, `it's \"x\"`, `pa#ss # x`, a PEM with `\n`, `value # comment` and `export KEY="..."` copy and read back exactly as the old app's `dotenv` reads them; a trailing backslash and a value with all three quote characters are refused by name. The throwaway parameters were deleted (0 remain). `py_compile` passes.

**Not tested.** A run with the real `.env` (Jayasoorya runs it and keeps the values private), and a real boot of the server with real SSM values.

**Risks and follow-ups.** A value the old app reads with a literal backslash before a quote (for example `\"`) is copied as that literal text, which is what the old app sees, so the new server sees the same. Check the "has line breaks" lines of the dry run against the old file by eye.

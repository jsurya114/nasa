# SSM copy script stores values of 4 to 8 KB in the advanced tier (nothing applied)

| Field | Value |
|---|---|
| Date | 2026-11-21 |
| Author | Jayasoorya, with Claude Code (Claude Sonnet 5.5) |
| Issue / PR | none / pull request into `develop` (see the PR); follows #312, #313, #315 |
| Branch | `infra/ssm-script-advanced-tier` (from `develop`) |
| Type / scope | `chore(repo)` |
| Files touched | `docs/infra/scripts/copy-env-to-ssm.py`, this entry. |
| Reserved files touched | None. |

**What and why.** The first real dry run on the old server's `.env` refused one setting, `REPORTING_DB_SSL_CA` (a chain of 3 certificates, 4,576 bytes), because a standard SSM parameter holds at most 4 KB. SSM's advanced tier holds up to 8 KB and costs about $0.05 a month per parameter. The script now stores a value of 4 to 8 KB with `Tier: Advanced`, marks it in the list ("over 4 KB: advanced tier, about $0.05 a month"), and refuses only values over 8 KB. Such a value now also goes through the renderer check (before, it was dropped before that check). The server's bootstrap reads parameters with `get-parameters-by-path`, which returns advanced parameters too, and `render-env.cjs` carries line breaks. Everything else is unchanged.

**Database.** None. **Config and dependencies.** None. One advanced-tier SSM parameter is created when the script runs on the real file (about $0.05 a month).

**Money impact.** None to pay or Excel; about $0.05 a month for the one advanced parameter.

**Tested.** Dry run on the real `.env`: 44 settings, none refused, the certificate chain marked as advanced tier. On a throwaway SSM path with dummy values: a 4.9 KB value with line breaks was stored as Advanced (the others Standard) and read back in full with `get-parameters-by-path`; a 9 KB value was refused and `--apply` wrote nothing. The throwaway parameters were deleted (0 remain). `py_compile` passes.

**Not tested.** A real boot of the server with the real SSM values (the first `api-new` boot).

**Risks and follow-ups.** An advanced parameter cannot be turned back into a standard one. If the certificate setting is later replaced by a bundle downloaded at boot, delete this parameter.

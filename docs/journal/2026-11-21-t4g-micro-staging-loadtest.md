# Staging stack, load test and sizing: t4g.micro is enough

| Field | Value |
|---|---|
| Date | 2026-11-20 to 2026-11-21 |
| Author | Jasil, with Claude Code (Claude Opus 5.5) |
| Issue / PR | none / this PR (PR #309 by Jayasoorya builds on it) |
| Branch | `infra/micro-staging-loadtest` (from `develop`) |
| Type / scope | `feat(backend)` for `/healthz` and the staging rate limit; `chore(repo)` for the rest |
| Files touched | `Backend/app.js`; new `Backend/middlewares/globalRateLimit.js` and `Backend/tests/globalRateLimit.test.js`; `docs/infra/terraform/` (staging mode, account lock, bootstrap fixes, NACL fix, tests); new `docs/infra/iam/` (staging deployer policy, guardrails, role boundary); `docs/infra/loadtest/` (new runner, workload, seed, workbook generator, metrics script, tests; the old `driver-day.mjs`, `k6-driver-day.js`, `mock-server.mjs` and `users.example.json` were removed); `docs/infra/AWS_NETWORK_PLAN.md`; `docs/infra/AWS_COST_OPTIMISATION.md`; this entry. |
| Reserved files touched | None of Jasil's Excel and pay files. `Backend/app.js` is Jayasoorya's area: two small additions, approved by Jasil, which need Jayasoorya's review. |

**What and why.** We needed to know whether the backend fits on the cheapest Graviton instance before moving production into the new VPC.
- **Backend.** Added `GET /healthz`, which needs no sign-in or database call and runs before the rate limit. The server setup script and a future load balancer use it. The global rate limit can now be raised **only in staging** (see Config).
- **Terraform.**
  - A `staging` mode: its own test database, local Redis, a load generator, and an allow-list of backend settings with no Everee, QuickBooks, email, push, Cloudinary or AI connector settings.
  - An account lock: `aws_profile`, `aws_account_id`, `allowed_account_ids`.
  - Fixes found by booting a real instance:
    - The npm package was missing.
    - Caddy could not read its config file, because of `umask 077`.
    - Direct mode's network ACLs blocked the database.
    - A one-instance refresh needed explicit preferences.
- **IAM.** A least-privilege staging deployer role with a permissions boundary and explicit guardrails. On 2026-11-21 its wildcard EC2, Auto Scaling, CloudWatch, Logs, SNS and Budgets allow was narrowed after a review: reads everywhere, EC2 changes only on resources tagged `Environment=staging`, and the rest only on `nasa-staging` names.
- **Load test.** It was run on a real `t4g.micro` against fictional data at production volume, then on a local copy with the micro's limits. Results and how to read them are in `docs/infra/loadtest/README.md#results`. In short: 50 drivers passed on AWS, and 100 drivers plus the weekly upload passed locally, as long as CPU credits are `unlimited`.

**Database.** None in production. The staging test database was created from production's **schema only**, with no rows. The schema came from a temporary RDS snapshot restore, which was deleted afterwards. It was filled with `seed-synthetic.sql`, which uses fictional names and `example.invalid` emails, and then destroyed.

**Config and dependencies.**
- New backend variables:
  - `NASA_ENVIRONMENT`: only the value `staging` matters.
  - `STAGING_GLOBAL_RATE_LIMIT_MAX`: a whole number from 1,000 to 100,000, used only when `NASA_ENVIRONMENT=staging`. In any other case the limit stays 1,000 per 15 minutes per address, and the value is logged as ignored.
- No new packages.
- Terraform: `aws_profile` and `aws_account_id` are now required, and new staging variables are refused in `prod` by validation.

**Money impact.** None to pay, rates, deductions or Excel imports. Infrastructure:
- The staging sessions cost about $0.20.
- The chosen production setup is about $36.10 a month before tax, against $38.75 today (`AWS_COST_OPTIMISATION.md` section 0).

**Tested.**
- Backend tests: 351 passed, 0 failed, 103 skipped, including 6 new rate-limit tests.
- Runner tests: 21 passed.
- `terraform validate` and `terraform test` passed, 7 runs.
- Staging was applied, booted, load-tested and destroyed in the NASA account. Destruction was verified: only production resources remain, and the staging state has 0 resources.
- Local Docker stages, as in the README.

**Not tested.**
- 100 drivers, and the upload during traffic, on a real micro (both only on the local copy).
- A multi-hour sustained run.
- `t4g.small`, which wasn't needed.
- Any production apply.
- The narrowed IAM policy is **not yet applied in AWS**. The live version is still the earlier one. It needs one staging plan and apply before it is relied on, since EC2 tag-based rules have exceptions that only show up in a real apply.

**Risks and follow-ups.**
- **Keep `cpu_credits = "unlimited"`.**
- The weekly upload blocks the event loop for about 16 s on a micro, and moving it to a worker thread would fix this. That is Jasil's Excel area.
- Found, not fixed:
  - Insights' fallback pool copies `pool.options` without the password.
  - A wrong upload file type returns 500 instead of 400.
  - The availability endpoint returns `err.message` to the user.
  - `DB_SSL` uses `rejectUnauthorized: false`.
  - The weekly upload's address set may count every row as a double stop (pay logic: flagged to Jasil, not changed).
  - In production, SSH is open to the internet, there are no EC2 backups, and RDS has 100 GB for about 0.6 GB of data.
- The seed creates 86 pay statements, not 470.
- Kept in AWS, free:
  - the staging state bucket, with a `loadtest-keep/` folder holding the schema dump, counts and results;
  - the deployer role and its three policies.
- Production migration (peering, jobs switch, cutover) is PR #309 and Jayasoorya's runbook in Slack.

# Load test: 1,000 users, 300 at once

Two equivalent scripts: `driver-day.mjs` (no install, Node 20+) and `k6-driver-day.js` (k6). Both log 300 test drivers in over 2 minutes, then each makes a read request every 3 to 12 seconds for 10 minutes (about 40 requests per second at peak). Read-only unless `--writes` is given.

**Never run against production.** `driver-day.mjs` refuses `*.nasaroutes.com` unless forced; do not force it.

## What was verified

Only the script itself: it was run against `mock-server.mjs` (a fake that answers in 5 to 45 ms) with 300 users: 7,050 requests, 0 errors, percentiles and the pass/fail verdict printed correctly, and the production guard blocked `api.nasaroutes.com`. **That says nothing about the real backend.** The real test has not been run: it needs a staging environment and test accounts.

## Before the first real run

1. **A staging target.** The new EC2 stack in direct mode with a different host name (for example `api-staging.nasaroutes.com`), and a **copy** of the database (never the live one). Use `TRUST_PROXY=1`, the same settings as production otherwise.
2. **300 test driver accounts** (`docs/infra/loadtest/users.json`, not committed): agreement signed, enabled, a few months of deliveries and some pay statements each, so the queries have real work to do. Fewer accounts work but repeat logins more than real life.
3. **The global rate limit must be raised on staging.** `Backend/app.js` line 64 limits every IP to **1000 requests per 15 minutes** (in memory). One load generator is one IP: at 40 requests per second it hits that limit in about 25 seconds and every later request is `429`. A small change makes it configurable (for example `RATE_LIMIT_MAX`, default 1000); that file is Jayasoorya's area, so ask first. Login limits are separate and do not matter for the test because a successful login clears them.
4. **A separate load generator**, a `t4g.small` or `c7g.large` in the same region and a different AZ, so the test machine is not the bottleneck. Do not run it from a laptop over home Wi-Fi.
5. **Detailed monitoring on** for the instance (`monitoring { enabled = true }` in the launch template, or the console) so CPU and credit metrics are per minute.

## What to watch while it runs

| Where | Look at | Concern |
|---|---|---|
| CloudWatch (instance) | `CPUUtilization`, `CPUCreditBalance`, `CPUSurplusCreditsCharged` | Burstable instance running out of credits = throttling or surprise cost |
| On the instance | `free -m`, `ps -o rss -p $(pgrep -f "node app.js")`, `systemctl status nasa-backend` | Memory growth, restarts |
| Database | `SELECT count(*), state FROM pg_stat_activity GROUP BY state;` | Connections: the pool is 10 per process by default, so queueing shows up as slow requests, not errors |
| Database | `pg_stat_statements` top queries by total time | Which query to index or cache |
| Redis | latency from the backend logs (`Redis did not answer in time`) | Login limits fall back to memory when Redis is slow |
| Script output | `429` count | Rate limit still too low |

## Pass criteria (starting values, change with the client)

- Error rate at most 1 percent, no `429` and no `5xx` bursts.
- p95 of every read endpoint at most 800 ms at 300 users; the login p95 is reported but not part of the gate.
- CPU average below 70 percent at steady state and no surplus-credit charges (burstable) at the end of 10 minutes; memory flat.
- Then run once more at 450 users (1.5x). The point is to know where it breaks, not to pass once.

## Run order

1. Baseline: the same test against the current `t3.micro` copy (or accept that it is the control). 2. New instance at `t4g.small`. 3. New instance at `t4g.medium`. 4. If CPU stays high on `t` types, `c7g.large`. Pick the smallest size that passes with headroom, then buy a commitment (see `docs/infra/AWS_COST_OPTIMISATION.md`).

# Load test: is a `t4g.micro` enough for NASA?

Short answer: **yes, with CPU credits in `unlimited` mode** (the Terraform default). The evidence is in [Results](#results).

## What is here

| File | What it does |
|---|---|
| `nasa-load.mjs` | The runner. Node 20+, no dependencies. Each virtual driver or admin logs in with its own account, calls every endpoint once, then picks endpoints by weight with think time in between. Optionally sends one weekly upload halfway through. |
| `workload.json` | The endpoints, their weights, think times and the p95 limit for each. Admin endpoints marked `superadminOnly` are only called by super admins, as in the app. |
| `lib/core.mjs` | Response checks, percentiles and the verdict. |
| `test/runner.test.mjs` | 21 tests of the runner against a fake server. Every way a run can go wrong must fail. Run: `node --test docs/infra/loadtest/test/runner.test.mjs` |
| `seed/seed-synthetic.sql` | Fictional data at production volume: 786 drivers, about 1.12 million deliveries, pay rows and pay runs. It refuses to run on any database except `nasa_staging`, or one that already has drivers. |
| `seed/make-weekly-workbook.mjs` | A fictional weekly carrier workbook (64,540 rows) and the totals the upload must report. |
| `collect-metrics.py` | One-minute CloudWatch figures for the instance and database, plus the backend's own memory log, for one stage's time window. |

`drivers.json`, `admins.json`, `results/` and `*.xlsx` are git-ignored. Never commit real accounts or real carrier files.

## Safety

- **It refuses production.** Any `*.nasaroutes.com` host is refused except `api-staging.nasaroutes.com`. A private address or IP is allowed.
- **It checks the target first.** `GET /healthz` must answer `{"status":"ok"}`, or nothing is sent.
- **One account per virtual user.** Duplicate or missing accounts are refused before any request.
- **Exit codes:** `0` pass, `1` fail, `2` refused to start.

## How a run is judged (fail-closed)

A stage passes only if all of these hold:
- the run finished;
- every planned login succeeded;
- every planned endpoint answered successfully at least once, with the expected body shape (a `200` with the wrong body counts as a failure);
- every endpoint's p95 is within its limit in `workload.json`;
- no request went to an endpoint outside the plan;
- at least 70% of the ideal request count was reached;
- the error rate is at most 1%;
- there were no rate-limited (`429`) and no timed-out requests;
- with `--upload-expect`, the upload's `recordsProcessed`, `recordsSkipped` and `recordsInserted` match the fixture exactly.

## Running it on staging

1. **Stack:** the Terraform in `docs/infra/terraform` with `environment = "staging"`. That gives a test database, local Redis, a load generator in another zone, and no integration settings (see its README).
2. **Data:** production's schema only (`pg_dump --schema-only --no-owner --no-privileges`, no rows), then `psql -v pwhash="'<bcrypt hash of a random test password>'" -f seed/seed-synthetic.sql`.
3. **Accounts:** `drivers.json` and `admins.json` in the shape of the `.example.json` files, using the seeded `loadtest-…@example.invalid` emails and the random password.
4. **Workbook:** `NODE_PATH=Backend/node_modules node seed/make-weekly-workbook.mjs weekly.xlsx weekly-expected.json`.
5. **Run each stage from the load generator,** for example:

```bash
node nasa-load.mjs --base https://<backend private name> --drivers drivers.json --admins admins.json \
  --driver-vus 50 --admin-vus 2 --ramp 60 --duration 300 --timeout-ms 60000 \
  --upload weekly.xlsx --upload-expect weekly-expected.json --stage d50-upload --out results/d50-upload.json
```

The global rate limit (1,000 requests per 15 minutes per address) is raised only in staging, through `STAGING_GLOBAL_RATE_LIMIT_MAX`. It works only when `NASA_ENVIRONMENT=staging`, and only from 1,000 to 100,000 (`Backend/middlewares/globalRateLimit.js`).

## Results

All runs used the same fictional data at production volume (786 drivers, 1,123,660 deliveries) and 2 admins, one of them a super admin. Ramp 60 s, then 300 s of steady load.

**On AWS (2026-11-20):** a real `t4g.micro` (2 vCPU, 1 GiB, no swap) and a `db.t3.micro` PostgreSQL 17.9, the same class as production.

| Stage | Verdict | Requests | Driver p95 | Instance CPU (avg) | Notes |
|---|---|---|---|---|---|
| 10 drivers | pass | 547 | 8–21 ms | not collected | First attempt void (a city admin was calling super-admin pages), fixed and rerun. |
| 25 drivers | pass | 1,289 | 8–17 ms | 1.8% | Node memory 145 MB; database free memory 54 MB; 0 surplus credits charged |
| 50 drivers | pass | 2,517 | 7–14 ms | 2.9% | 0 errors; database CPU 4.8%; 3 database connections |
| Weekly upload alone | totals exact | 1 | — | — | 64,540 rows in 16.2 s. Node memory 145 → 383 MB. **Other requests waited up to 6.3 s.** |

**On a local copy at the micro's limits (2026-11-21):** Docker on an Apple M3. The backend had 2 CPUs and 670 MB with no swap: what the real micro had left after the OS, Caddy and Redis. PostgreSQL 17 had 2 CPUs and 1 GiB.

| Stage | Verdict | Requests | Backend CPU avg (1 core = 100%) | Backend memory peak |
|---|---|---|---|---|
| 50 drivers | pass | 2,499 | 3.4% | 366 MB |
| 100 drivers | pass | 5,012 | 6.2% | 160 MB |
| 100 drivers + weekly upload | pass, totals exact | 5,002 | 6.7% | 438 MB |
| 100 drivers + upload, CPU capped at 0.2 | **fail** | 3,613 | 10.9% (cap 20%) | 496 MB |

**How to read it**
- **CPU:** 100 drivers at once used about 3.4% of the instance. A micro may run at 10% without spending credits, so the credit balance grows on a normal day.
- **Memory:** 1 GiB is enough. The worst moment was under 500 MB of the 670 MB the app has, with no restart and no out-of-memory.
- **The failed stage** copies a micro in `standard` credit mode with its credits used up, when AWS slows it to 10% of each CPU. The upload then holds the only Node thread long enough that it timed out after 60 s, and other requests waited 20 to 45 s. **In `unlimited` mode the instance is never slowed down,** so this does not happen. Extra CPU is billed at $0.04 per vCPU-hour, only beyond the earned credits.
- **The upload freezes the backend at any size.** It parses the whole workbook on the event loop. A larger instance does not help, because Node runs it on one core. The fix is in the code: move the parsing to a worker thread.
- **The local copy against AWS:** light requests matched closely (driver p95 9–22 ms locally against 7–14 ms on AWS; logins about 120 ms on both). CPU-heavy work ran about 4× faster on the M3 (the upload took 3.6 s against 16 s), so local results understate how long the upload freeze lasts on a real micro.

**Not run:** 100 drivers on a real micro; the upload during traffic on a real micro; a multi-hour sustained run (CPU credits were estimated from measured CPU instead).

**Known gap in the seed:** it produced 86 pay statements, not the 470 its header targets. Pay statement endpoints read fewer rows than in production.

## Running it locally

Use this for memory and code behaviour, not for capacity numbers. You need Docker (for example OrbStack) and the schema dump.
- Build the backend image from a clean `git archive` copy, so no local `.env` is included.
- Start PostgreSQL 17 (`--cpus 2 --memory 1g`, `shared_buffers=200MB`) and Valkey.
- Start the backend with `--cpus 2 --memory 670m --memory-swap 670m`, `NODE_OPTIONS=--max-old-space-size=384`, and the same allow-list of settings as staging.
- Seed it as above, then run `nasa-load.mjs` from the host against `http://127.0.0.1:<port>`. `docker update --cpus 0.2` copies the no-credits case.

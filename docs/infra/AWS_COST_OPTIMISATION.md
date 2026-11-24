# NASA AWS cost optimisation: safe steps, sizing and the database

Written 2026-11-19, updated 2026-11-21. **Section 0 holds confirmed figures:** the AWS Price List API, the account's real bill, and the load test. Sections 1 to 5 are the original research from third-party price sites, kept for comparing options. Hours per month = 730.

## 0. Confirmed (2026-11-21)

**Today's bill.** About $41 a month including tax (August to October 2026: $41.31, $40.46, $41.31). October was $41.31 with tax and **$38.75 before tax**. The lines below are from the bill and **include tax**: each is about 6.6% above the on-demand rate for 744 hours. Compare the before-tax total, $38.75, with the before-tax rates in the next table.

| Line (October 2026, 744 hours, including tax) | Cost |
|---|---|
| RDS `db.t3.micro` (PostgreSQL 17.9, single-AZ) | $14.27 |
| RDS storage, 100 GB gp3 (about 0.6 GB used) | $12.26 |
| EC2 `t3.micro` | $8.25 |
| Public IPv4 address (Elastic IP) | $3.97 |
| EBS root volume, 30 GB gp3 | $2.56 |
| **Total including tax** (before tax: $38.75) | **$41.31** |

**The database is already on RDS,** in the default VPC. It stays there; the new VPC reaches it over VPC peering.

**Chosen setup:** `t4g.micro`, `cpu_credits = "unlimited"`, direct mode (no load balancer, no NAT), one instance in the database's zone. This was decided from the [load test](loadtest/README.md#results).

| Item (us-east-1 on-demand, Price List API) | Rate | Per month |
|---|---|---|
| EC2 `t4g.micro` | $0.0084/h | $6.13 |
| EBS gp3, 20 GB | $0.08/GB | $1.60 |
| Public IPv4 (Elastic IP) | $0.005/h | $3.65 |
| RDS `db.t3.micro` (unchanged) | $0.018/h | $13.14 |
| RDS gp3 storage, 100 GB (unchanged) | $0.115/GB | $11.50 |
| VPC peering, alarms, budget, SSM, S3 endpoint | free tier, or no hourly charge | about $0 |
| CPU surplus credits (`t4g`, only beyond earned credits) | $0.04/vCPU-hour | expected $0 |
| **Total before tax** | | **about $36.10** (today about $38.75) |

For comparison: `t4g.small` is $0.0168/h ($12.26 a month, about $42 in total), and `t4g.medium` is $0.0336/h ($24.53, about $54).

**The biggest remaining saving is the database storage:** 100 GB down to 20 GB would save about $9.20 a month. RDS cannot shrink storage in place, so it needs a move to a new instance, planned separately. `db.t3.micro` to `db.t4g.micro` would save about $1.50.

**One-off cost of the move:** about $3.50 for keeping the old server for one week as a rollback.

## 1. What the options cost (us-east-1, on-demand, Linux)

| Item | Rate found | About per month | Source / confidence |
|---|---|---|---|
| `t3.micro` (today) | $0.0104/h | $7.6 | two price sites agree |
| `t3.small` | $0.0208/h | $15.2 | price site (AWS page shows $0.0209) |
| `t4g.small` (Graviton, 2 GiB) | $0.0168/h | $12.3 | price sites agree |
| `t4g.medium` (Graviton, 4 GiB) | $0.0336/h | $24.5 | **only a 2021 AWS page copy found: verify** |
| Application Load Balancer | $0.0225/h + $0.008 per LCU-hour | $16.4 + usage | third-party guide, verify |
| NAT gateway | $0.045/h + $0.045 per GB | $32.9 + data | AWS snippet (region not named), verify |
| Public IPv4 address | $0.005/h each, in use or idle | $3.65 each | AWS load balancer page |
| EBS gp3 | not researched | about $1.6 for 20 GB (typical $0.08/GB) | **verify** |

**Network add-ons are the cost trap, not the instance.** A rough monthly picture:

| Setup | Items | About |
|---|---|---|
| Today | `t3.micro` + one public IP + disk | $12 to $14 |
| **Chosen (direct mode)** | `t4g.micro` + one Elastic IP + 20 GB disk | **about $11.40** (see section 0) |
| ALB mode | `t4g.medium` + disk + ALB + 2 ALB public IPs + NAT + NAT public IP | **about $86**, plus ALB usage and NAT data |
| Database inside AWS (future) | not included | see section 5 |

Why ALB mode costs about three times direct mode: the ALB itself is about $16, but putting instances in private subnets also needs a NAT gateway (about $33) because the backend must reach Everee, QuickBooks, Cloudinary, Expo and its database. That is why `enable_alb` defaults to `false`. A cheaper way to give private instances internet access is a small "NAT instance" (a `t4g.nano` running a maintained NAT image, a few dollars a month), at the price of managing it yourself; it is not implemented here.

## 2. Safe steps, from lowest to highest risk

Every step is reversible, and each one is checked against the load test (`docs/infra/loadtest/README.md`) before and after.

1. **Make the spend visible.** Terraform creates a monthly budget with email alerts and tags everything `Project=nasa`. Turn on Cost Explorer and group by tag. No user impact.
2. **Remove waste.** Find and delete unattached EBS volumes, old snapshots and AMIs, and Elastic IPs that are not attached (each idle public IPv4 costs about $3.65). Look before deleting; snapshot anything unsure.
3. **Use the cheaper kind of the same thing.** `gp3` instead of `gp2` disks (online change, no downtime). Graviton (`t4g`) instead of `t3`: about 10 to 20 percent cheaper per unit (sources differ). The backend has no native module that blocks arm64 (`bcrypt` ships arm64 builds, `xlsx` and `exceljs` are pure JavaScript) but test on a copy first.
4. **Right-size from measurements, not guesses.** Load test `t4g.small` and `t4g.medium`; keep the smallest that passes with headroom. Do **not** shrink before measuring: Excel parsing needs memory.
5. **Keep the network minimal until it is needed.** One NAT (not one per AZ), no ALB, S3 gateway endpoint (free), log retention 14 days, flow logs off, detailed monitoring off except during tests. No WAF or GuardDuty until a real need (each has a monthly floor).
6. **Commit only once the size is stable (after about a month).** AWS's own table shows an average 1-year discount of up to 29 percent for Compute and EC2 Instance Savings Plans (Reserved Instances up to 38 percent for fixed instance types). A **Compute Savings Plan** survives a change of instance family (for example `t4g` to `c7g`), so it is the safer first commitment. **Commit only to the steady baseline** (the one instance), never to peak or to the ALB.
7. **Non-production stacks off outside working hours** (a scheduled desired = 0), if a staging stack is kept.

**Not recommended:** Spot instances for a single production backend (a reclaim is an outage); shrinking the database or instance without a rollback plan; buying a Savings Plan before the load test; turning on multi-AZ NAT or a second instance "for safety" before there is a measured reason.

**Burstable (`t`) instances:** the baseline is a fraction of a CPU. In `unlimited` mode (the Terraform default) extra CPU is billed as surplus credits rather than throttled. The surplus rate for `t4g` is $0.04 per vCPU-hour (Price List API). The load test measured about 3.4% average CPU at 100 drivers at once, against a 10% baseline, so no surplus is expected. If the load test shows CPU above the baseline for most of the run, a fixed-performance type (`c7g.large`, `m7g.large`) will be cheaper than a larger burstable one.

## 3. Findings from the code that change the cost picture

- **Single-runner cron jobs.** The web process runs the availability reset (hourly) and Everee sync (every 5 and 15 minutes). That caps the Auto Scaling group at one instance (`asg_max = 1`) until a database advisory lock or a flag is added. Real autoscaling is a code change first, an infrastructure change second.
- **Global rate limit.** `Backend/app.js` allows 1,000 requests per IP per 15 minutes, counted in memory. Drivers sharing one public IP (a depot or office Wi-Fi) share that budget. Worth checking the logs for `429` from real traffic.
- **No health route.** The ALB needs `GET /healthz`. Without it an enabled ALB marks the instance unhealthy and replaces it in a loop.
- **Redis.** The backend uses an external hosted Redis (login limits and token blacklist). Jayasoorya saw "Redis did not answer in time" in the log; login limits then fall back to memory. If that Redis is far from the new region or on a free tier, it will show in login latency. Check its plan and region.
- **Uploads in memory.** Excel files are read in memory (limit 50 MB; the real weekly file is 1.3 MB). On a `t4g.micro` (heap 384 MB) the 64,540-row weekly upload peaked at 383 MB of Node memory alone and 438 MB during 100 drivers' traffic, within the 1 GiB instance; lowering the limit to about 10 MB would remove the worst case at no cost.

## 4. The three things to decide first

1. ~~Where PostgreSQL runs~~: RDS `db.t3.micro` in the default VPC (confirmed 2026-11-20).
2. ~~Region~~: us-east-1. **Still open:** where `nasaroutes.com` DNS lives.
3. Whether a few minutes of downtime on a quiet night is acceptable for the cutover (the plan assumes yes).

## 5. Database cost reduction (safe order)

**Step 0, before any change: find out what you have.** Nothing below can be chosen without it. Read-only checks:

```sql
-- size and the biggest tables
SELECT pg_size_pretty(pg_database_size(current_database())) AS database;
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total, n_live_tup, n_dead_tup
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 15;
-- connections now and the limit
SELECT count(*) AS connections FROM pg_stat_activity; SHOW max_connections;
-- indexes never used since the last statistics reset (check the reset date first; do not drop yet)
SELECT s.relname, s.indexrelname, pg_size_pretty(pg_relation_size(s.indexrelid)) AS size, s.idx_scan
FROM pg_stat_user_indexes s JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE s.idx_scan = 0 AND NOT i.indisunique ORDER BY pg_relation_size(s.indexrelid) DESC LIMIT 15;
SELECT stats_reset FROM pg_stat_database WHERE datname = current_database();
-- slowest queries, if the extension is on
SELECT calls, round(total_exec_time) AS total_ms, round(mean_exec_time) AS mean_ms, left(query, 80) FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;
```
The weekly upload keeps the uploaded file only while it is awaiting review (`carrier_statement_imports.file`, emptied afterwards), so it should not be a growing cost; the large tables are more likely the Excel data and delivery records.

**Then choose by where the database runs:**

| If PostgreSQL is... | Safe steps |
|---|---|
| **On the `t3.micro` itself** | The bigger risk is not the bill: the database competes with Node for 1 GiB of memory and a single disk. Plan to move it to a managed instance (`db.t4g.small` or `db.t4g.medium`, single-AZ at first, `gp3`, 7-day backups) in the data tier, with a restore test and a rollback window. The monthly bill will rise a little and the risk falls a lot. Multi-AZ later, when the business needs automatic failover. |
| **On RDS** | (1) CloudWatch, 14 days: maximum CPU, FreeableMemory, connections, read/write IOPS. If peak CPU is below about 30 percent and memory is not tight, go down one size. (2) `gp2` to `gp3`, online. (3) x86 class (`db.t3`) to Graviton (`db.t4g`): a restart, in a maintenance window, after a snapshot; an existing reservation on the x86 family does **not** carry over. (4) Backup retention 7 days; delete old manual snapshots. (5) Performance Insights at the free 7-day level. (6) Turn on storage autoscaling with a ceiling. (7) After two stable months, a 1-year no-upfront reservation for the baseline. Keep Multi-AZ if it is on. |
| **An outside provider** | Compare its plan limits against Step 0 (size, connections, compute hours). Moving to RDS is not automatically cheaper. |

**The rule for every database change:** snapshot first; one change at a time; in a quiet window; re-run the load test and compare p95; know the rollback before starting.

**Safe in the application too (separate small changes, each reviewed):** set the connection pool size explicitly (it is the default 10); add an index only for a query that Step 0 shows is slow; and agree a retention rule for old raw Excel rows before anyone deletes data. None of these were changed here.

## 6. Sources

- [EC2 on-demand pricing](https://aws.amazon.com/ec2/pricing/on-demand/), [t4g.small price](https://calculator.holori.com/aws/ec2/t4g.small), [t3.micro price](https://www.doit.com/compute/spot/us-east-1/t3.micro), [t3.small price](https://www.doit.com/compute/spot/us-east-1/t3.small)
- [Elastic Load Balancing pricing](https://aws.amazon.com/elasticloadbalancing/pricing/?z=3), [Amazon VPC pricing](https://aws.amazon.com/vpc/pricing/), [NAT gateway pricing](https://docs.aws.amazon.com/vpc/latest/userguide//nat-gateway-pricing.html), [ALB pricing guide](https://www.cloudzero.com/blog/aws-alb-pricing/)
- [Savings Plans types](https://docs.aws.amazon.com/savingsplans/latest/userguide/plan-types.html), [Savings Plans and Reserved Instances](https://docs.aws.amazon.com/en_us/savingsplans/latest/userguide/sp-ris.html), [Savings Plans whitepaper](https://docs.aws.amazon.com/en_us/whitepapers/latest/cost-optimization-reservation-models/savings-plans.html)
- [RDS PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/), [Optimizing costs in Amazon RDS](https://aws.amazon.com/blogs/database/optimizing-costs-in-amazon-rds/), [Compute Optimizer for RDS](https://aws.amazon.com/blogs/database/how-to-optimize-amazon-rds-and-amazon-aurora-database-costs-performance-with-aws-compute-optimizer), [Graviton for RDS](https://www.infracost.io/finops-policies/amazon-rds-consider-using-graviton-instances)

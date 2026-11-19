# NASA AWS network plan

Status: **proposal, nothing applied.** Code: `docs/infra/terraform/`. Written 2026-11-19.
Today: one `t3.micro` in the **default VPC**, deployed by hand (git pull, pm2, nginx + certbot). Frontend on Vercel. Redis is an external hosted service. Where the PostgreSQL database runs is **not confirmed** (see section 9).

## 1. Goals and limits

| Goal | How this plan meets it |
|---|---|
| A real network, not the default VPC | Own VPC with public, app and data tiers in 2 Availability Zones |
| Cheap to run now | ALB and NAT are **switches that default to off**; one instance (desired = 1) |
| Ready to grow | Turning on `enable_alb` moves the instance behind a load balancer into private subnets, without redrawing the network |
| ~1,000 users, ~300 concurrent | Sized by load test before the instance type is fixed (section 7 and `docs/infra/AWS_COST_OPTIMISATION.md`) |
| No SSH, no secrets in code | SSM Session Manager for access; settings in SSM Parameter Store; secrets never in Terraform state |

Limit to know: the backend runs **cron jobs inside the web process** (hourly availability reset, Everee sync every 5 and 15 minutes). A second instance would run them twice. So the Auto Scaling group is `min 1 / desired 1 / max 1` until a single-runner lock exists. The scaling policy is already defined and takes effect when `asg_max` is raised.

## 2. Address plan

VPC `10.20.0.0/16` (outside the default VPC's `172.31.0.0/16`, so the two can be peered during the move). Each tier gets one `/24` per Availability Zone.

| Tier | AZ a | AZ b | AZ c (reserved) | Holds |
|---|---|---|---|---|
| public | 10.20.0.0/24 | 10.20.1.0/24 | 10.20.2.0/24 | ALB, NAT gateway, and the instance in direct mode |
| app | 10.20.10.0/24 | 10.20.11.0/24 | 10.20.12.0/24 | Backend instances in ALB mode (private) |
| data | 10.20.20.0/24 | 10.20.21.0/24 | 10.20.22.0/24 | Future database / cache. No route to the internet |

Unused ranges (`10.20.30.0/24` onward) are kept free for a staging environment or a second tier.

## 3. Picture

```
                    Internet
                       |
        Vercel (frontend)  --HTTPS-->  api.nasaroutes.com
                       |
   +-------------------+----------------------- VPC 10.20.0.0/16 ----------------------+
   |   PUBLIC  10.20.0.0/24 (a) , 10.20.1.0/24 (b)                                     |
   |     ALB (off by default)        NAT gateway (off by default)                      |
   |     DIRECT MODE: the backend instance itself + Elastic IP + Caddy (TLS)           |
   |                       |  app port 3251 (ALB mode only)                            |
   |   APP     10.20.10.0/24 (a) , 10.20.11.0/24 (b)                                   |
   |     Backend instances (Auto Scaling group, desired 1)  --outbound via NAT-->      |
   |        Everee, QuickBooks, Cloudinary, Expo push, Redis (hosted), PostgreSQL*     |
   |                       |  5432                                                     |
   |   DATA    10.20.20.0/24 (a) , 10.20.21.0/24 (b)   (empty today; future RDS)       |
   +-----------------------------------------------------------------------------------+
   * the database stays where it is until the migration step in section 8
```

## 4. Two modes (one variable: `enable_alb`)

| | **Direct mode** (default, cheapest) | **ALB mode** (target) |
|---|---|---|
| Entry | Internet -> instance (Caddy on 80/443) | Internet -> ALB (443, ACM certificate) -> instance |
| Instance subnet | public, public IP + Elastic IP | app (private), no public IP |
| NAT gateway | off | **on** (forced) |
| Instance inbound | 80, 443 from the internet | app port 3251 from the ALB security group only |
| Extra monthly cost | about $4 (one public IPv4) | about $16 (ALB) + about $33 (NAT) + data, see cost table |
| Needs before use | the Terraform apply and a release in S3 | the same, **plus** a `GET /healthz` route in the backend (it has none today) |

Moving between the modes is a variable change and an apply. The Auto Scaling group replaces the instance launch-before-terminate (instance refresh at 100 to 200 percent), so the switch does not need a gap.

## 5. Route tables

| Table | Routes |
|---|---|
| public (shared) | `10.20.0.0/16` local; `0.0.0.0/0` to the internet gateway; S3 gateway endpoint |
| app (one per AZ) | local; `0.0.0.0/0` to the NAT gateway **only when NAT is on**; S3 gateway endpoint |
| data | local only |

The S3 gateway endpoint is free; release downloads do not use the NAT. With one shared NAT (`nat_per_az = false`) an outage of the NAT's AZ cuts outbound traffic for the other AZ too: acceptable for the cost saving, and documented as the trade.

## 6. Security groups and network ACLs

Security groups (stateful) carry the real rules. Network ACLs (stateless) are a coarse second layer that is strict about what may **enter** a tier.

**Security groups**

| Group | Inbound | Outbound |
|---|---|---|
| alb | 443 and 80 from `0.0.0.0/0` (80 only redirects) | app port to the app group |
| app | app port from the alb group; **direct mode only:** 80 and 443 from `0.0.0.0/0`; **no SSH** | all (Everee, QuickBooks, Cloudinary, Expo, Redis, database, packages) |
| data | database port from the app group only | none |
| default | none (emptied) | none |

**Network ACLs**

| Tier | Inbound allowed | Outbound allowed |
|---|---|---|
| public | 80, 443 from anywhere; ephemeral 1024-65535 from anywhere (replies); everything from the app subnets (they use the NAT) | all |
| app | app port from the public subnets; ephemeral 1024-65535 from anywhere (replies via NAT) | all |
| data | database port from the app subnets only | ephemeral 1024-65535 to the app subnets only |

Outbound from the public and app tiers is left open on purpose: the backend talks to services whose addresses change. Because NACLs are stateless, a missing ephemeral-port rule shows up as hanging connections, not as a clear error: the first thing to check if a connection stalls after a change.

## 7. Sizing and capacity (to be confirmed by load test)

- 1,000 users, about 300 at once. The driver app is mostly short JSON calls (profile, availability, deliveries, pay statements); the heavy work is admin Excel upload and reporting.
- Starting instance: `t4g.medium` (2 vCPU, 4 GiB, Graviton). Reasons: 4 GiB leaves room for Excel parsing next to the Node process; Graviton is cheaper per unit than `t3`. `t4g.small` is the fall-back if the load test shows headroom.
- Burstable (`t`) instances throttle when CPU credits run out, or bill surplus credits in unlimited mode. If the load test shows sustained CPU above the baseline, a fixed-performance type (`c7g.large` or `m7g.large`) is the right choice instead of a bigger `t`.
- The database connection pool defaults to 10 per process (no setting in `Backend/config/db.js`). 300 concurrent users must not mean 300 database connections; the load test watches this.

## 8. Migration plan (no big bang)

1. **Prepare (no user impact).** Apply `docs/infra/terraform/bootstrap`, then the main stack in direct mode in a test AWS account or with a different `api_domain` such as `api-new.nasaroutes.com`. Put the backend settings in SSM Parameter Store. Upload a release with `docs/infra/scripts/package-backend.sh`.
2. **Prove it.** Run the load test against this new instance (staging data or a copy). Compare with the current t3.micro. Decide the final instance type.
3. **Database first, only if it is on the instance.** If PostgreSQL runs on the t3.micro, move it **before** the app: dump and restore to the managed database, test, and keep the old one read-only for a rollback window. If it is already an external or managed database, the network change does not touch it.
4. **Cut over DNS** for `api.nasaroutes.com` to the Elastic IP (low TTL set a day before). Watch errors and CPU for a day. Keep the old server running, untouched, for rollback.
5. **Switch off the old server** after a quiet week (stop first, delete later; snapshot the volume).
6. **Turn on the ALB** when traffic or availability needs it: add `GET /healthz`, set `enable_alb = true`, apply, move the DNS record to the ALB.
7. **Scale beyond one** only after the cron jobs run on a single instance (database advisory lock or a flag).

## 9. Open questions (answers change the plan)

1. Region of the current server (the plan assumes `us-east-1`).
2. Where PostgreSQL runs: on the t3.micro, RDS, or an outside provider. Size and monthly bill.
3. Where `nasaroutes.com` DNS lives (Route 53, Vercel or a registrar): decides who creates the validation and A records.
4. Which AWS account to build in: the only local AWS profile belongs to a different project, so a NASA profile is needed before any apply.
5. Acceptable downtime for the cutover and for a database move (a quiet window, for example Sunday night).
6. Who owns `app.js`: the `/healthz` route lives in Jayasoorya's area.

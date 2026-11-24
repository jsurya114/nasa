# Moving the NASA backend to its own AWS network

Status: **done on 24 November 2026.** The backend that serves `api.nasaroutes.com` now runs on a `t4g.micro` in its own VPC, built with Terraform. The old server is stopped (not deleted) as the rollback copy. Written 2026-11-24 for anyone new who needs to understand the setup, operate it, or build it again from this page and the files it links.

Related files: the Terraform code and how to apply it ([`terraform/README.md`](terraform/README.md)), the design and address plan ([`AWS_NETWORK_PLAN.md`](AWS_NETWORK_PLAN.md)), costs ([`AWS_COST_OPTIMISATION.md`](AWS_COST_OPTIMISATION.md)), the load test ([`loadtest/README.md`](loadtest/README.md)), and the exact cutover commands ([`CUTOVER_RUNBOOK.md`](CUTOVER_RUNBOOK.md)).

This repository is public, so this page has no account number, IP address, or instance, volume or snapshot ID. It uses names and roles. The real values are looked up with commands (see the runbook) and kept in the private AWS account.

**Contents:** 1 Old setup · 2 New setup · 3 Why · 4 How it was done · 5 Rollback · 6 What is next · 7 Operations

---

## 1. The old setup

| Part | What it was |
|---|---|
| Server | One EC2 `t3.micro` in the **default VPC**, built by hand. |
| Web server | nginx in front of the app, with certbot for the HTTPS certificate. |
| App | The Node backend under PM2 (`nasa-backend`), port 3251, code in the user's home folder. |
| Deploys | By hand over SSH: `git pull`, then restart in PM2. |
| Database | RDS PostgreSQL `db.t3.micro` in the default VPC, private, port 5432 open only to the server's security group. 100 GB gp3 storage (about 0.6 GB used), 7-day backups. |
| Cache | Redis Cloud, a hosted service outside AWS. The app uses it for login limits and falls back to memory when it does not answer. |
| DNS | At GoDaddy (name servers `domaincontrol.com`). `api.nasaroutes.com` is an A record pointing at the server's Elastic IP. The site itself is on Vercel. |
| Scheduled jobs | Three jobs run inside the web process: the hourly availability reset (acts only on Sunday noon local time), the Everee payment check (every 15 minutes) and the Everee onboarding sync (every 5 minutes). |

**What was wrong with it**
- Nothing of it was in code. The network, the server and its settings existed only in the console and on the machine, so none of it could be reviewed or rebuilt.
- SSH was open to reach the server.
- One hand-built server. If it was lost, someone had to rebuild it by hand, and deploys depended on one person's shell.
- The settings (about 44) lived in one `.env` file on that machine.

There was nothing wrong with the application code for this move. The backend changed by only three small files (section 4).

## 2. The new setup

### 2.1 Side by side

```
BEFORE                                      AFTER
(until 24 Nov 2026)                         (since 24 Nov 2026)

 Browser / Vercel frontend                   Browser / Vercel frontend
            |                                           |
 GoDaddy DNS: api -> Elastic IP              GoDaddy DNS: api -> the SAME Elastic IP
            |                                           |  (the IP moved; the record did not)
 +-- default VPC 172.31.0.0/16 --+           +-- new VPC 10.20.0.0/16 -----------+
 |  EC2 t3.micro (by hand)       |           |  public subnet, AZ a              |
 |   nginx + certbot (80/443)    |           |   EC2 t4g.micro, unlimited credits|
 |   PM2 -> Node app :3251       |           |   Auto Scaling group 1 / 1 / 1    |
 |   SSH open                    |           |   Caddy (80/443) -> Node app :3251|
 |          |                    |           |   no SSH (SSM Session Manager)    |
 |          | 5432               |           +-----------------|-----------------+
 |          v                    |                             | 5432
 |  RDS PostgreSQL db.t3.micro   |           +-- default VPC 172.31.0.0/16 -----+
 +-------------------------------+           |  VPC peering (one route each side)|
                                             |  RDS PostgreSQL db.t3.micro       |
                                             |  (unchanged, not moved)           |
                                             +-----------------------------------+

 Both: Redis Cloud (hosted) and Everee, QuickBooks, Cloudinary, Expo, reached over the internet.
```

### 2.2 The request path

A driver or admin opens the site on Vercel; the page calls the API:

1. The browser asks DNS for `api.nasaroutes.com`: the GoDaddy A record returns the Elastic IP.
2. The request goes through the internet gateway into the new VPC's **public subnet**, to the instance (security group: ports 80 and 443 from anywhere, nothing else, no SSH).
3. **Caddy** on the instance ends the HTTPS connection (a Let's Encrypt certificate it gets and renews by itself) and passes the request to the Node app on `127.0.0.1:3251`.
4. The app checks the login token, then reads or writes **PostgreSQL**. The new VPC has a route for `172.31.0.0/16` through the **peering connection**, so the connection to the database's private address stays inside AWS. The database's security group has one extra rule: port 5432 from the new app security group.
5. For login limits the app calls **Redis Cloud**; for payments and bookkeeping it calls **Everee** and **QuickBooks**; for images **Cloudinary**. These go out through the instance's public address.
6. The response goes back the same way: app, Caddy, internet gateway, browser.

### 2.3 The parts

| Part | What it is |
|---|---|
| VPC `10.20.0.0/16` | Outside the default VPC's range so the two can be peered. Public, app and data subnets (one `/24` each per zone) in 2 Availability Zones. Address plan: [`AWS_NETWORK_PLAN.md` section 2](AWS_NETWORK_PLAN.md). |
| Direct mode | `enable_alb = false`, `enable_nat_gateway = false`. The instance sits in the public subnet with the Elastic IP and serves the internet itself. The load balancer and NAT are one variable away (`enable_alb`), not built. |
| Instance | `t4g.micro` (2 vCPU, 1 GiB), Amazon Linux 2023, `cpu_credits = "unlimited"` (must stay on, see section 3), 20 GB encrypted gp3 root disk, IMDSv2 required, in the database's zone (`us-east-1a`). |
| Auto Scaling group | `min 1 / desired 1 / max 1`: the group keeps one instance and starts a new one if it is lost. It cannot go above 1 until the jobs have a lock (section 6). |
| Caddy | Terminates HTTPS and proxies to the app. Config in `/etc/caddy/Caddyfile`. |
| Settings | One SecureString per setting under `/nasa/prod/` in SSM Parameter Store (44 of them; one, the database certificate chain, uses the advanced tier because it is over 4 KB). At boot, `render-env.cjs` writes them to `/opt/nasa/Backend/.env` (mode 600), quoting every value so the app's own `dotenv` reads each back exactly, and stops with the setting's *name* (never its value) if one would not survive. The values were copied from the old `.env` by `scripts/copy-env-to-ssm.py`; they are not Terraform resources, so `terraform apply` does not touch them. |
| Release bucket | An encrypted, versioned S3 bucket that holds the backend release (`backend-latest.tgz`), built by `scripts/package-backend.sh`. The instance downloads it at first boot. |
| Instance role | SSM Session Manager access, read of the release bucket and of `/nasa/prod/*`, and permission to attach its Elastic IP. No SSH key, no port 22. |
| Monitoring | CloudWatch alarms `nasa-prod-cpu-high` and `nasa-prod-no-instances` (more only when the load balancer is on), an SNS topic that emails the alert address, and a $50 monthly budget. |
| Peering | A peering connection to the default VPC, with DNS resolution on both sides, one route in each VPC and one 5432 rule on the database's security group. These are the only changes to existing production resources, and all are additions (`create` only in the plan). |
| The jobs switch | `SCHEDULED_JOBS_ENABLED` (read once at start-up; `false` turns the three jobs off). Used so that two servers sharing the database never both run the jobs. It is `true` on the new server. |
| Health route | `GET /healthz` (no sign-in, no database call) returns `{"status":"ok"}`. The bootstrap waits for it, and it proves which server answers. |

How the instance builds itself (`user_data.sh.tpl`, log `/var/log/nasa-bootstrap.log`): install Node, download the release, `npm ci`, render the settings, start the `nasa-backend` service, wait for `/healthz`, start Caddy, and only then take the Elastic IP, so traffic never moves to an instance whose backend is not up.

## 3. Why we did it this way

| Decision | Evidence and reason |
|---|---|
| **`t4g.micro`, not `t4g.medium`** | Load tests ([`loadtest/README.md`](loadtest/README.md#results)): on a real micro, 50 drivers at once used about 3% CPU (driver p95 7 to 14 ms); on a local copy with the same limits, 100 drivers plus the weekly upload passed and peaked at 438 MB of the 670 MB left for the app. A micro is about $6 a month, a medium about $24.50. |
| **Unlimited credits** | With `standard` credits, a micro whose credits run out is held to 10% of each CPU: the weekly upload times out and other requests stall 20 to 45 seconds. In `unlimited` mode that cannot happen, and extra CPU costs $0.04 per vCPU-hour. Normal use earns more credits than it spends (the balance has stayed at the cap). |
| **Direct mode, no load balancer, no NAT** | A load balancer needs private subnets, and private subnets need a NAT gateway for Everee, QuickBooks and the database. ALB mode would cost about $86 a month for the compute and network part, against about $11.40 for direct mode. With one instance the load balancer adds nothing a single instance with Caddy does not do. |
| **Peering, not a database move** | The database is already RDS. Moving it adds risk to the data for no gain now. Peering adds only a connection, a route in each VPC and one security group rule, all additions. |
| **Move the Elastic IP, not change DNS** | DNS is at GoDaddy and nobody on the team had a sign-in. `api.nasaroutes.com` already points at the old server's Elastic IP, so moving that IP to the new server needs no DNS change, no TTL wait, and any IP allow-list at Everee or QuickBooks keeps working. Rollback is moving the IP back instead of waiting for DNS caches. |
| **One instance, jobs on one server** | The backend runs its cron jobs inside the web process, with no lock between servers. Two servers would run each job twice, including Everee payment work. So the group stays at 1 and the old app is kept stopped. |

**Cost** (us-east-1 on-demand, Price List API; details in [`AWS_COST_OPTIMISATION.md`](AWS_COST_OPTIMISATION.md#0-confirmed-2026-11-21)):

Before: about **$38.75 a month before tax** (October 2026, from the account's bill; about $41 with tax). After, by component:

| Item | Per month |
|---|---|
| EC2 `t4g.micro` | $6.13 |
| Root disk, 20 GB gp3 | $1.60 |
| Public IPv4 (Elastic IP) | $3.65 |
| RDS `db.t3.micro` and 100 GB storage (unchanged) | about $24.60 |
| VPC peering, alarms, budget, SSM, S3 endpoint | about $0 |
| CPU surplus credits (only beyond earned credits) | expected $0 |
| **Total before tax** | **about $36** |

Short-term extras until the cleanup in section 6: the idle spare Elastic IP (about $3.65 a month), the stopped old instance's 30 GB disk (about $2.50), and snapshots of the old disk and the database (small). The biggest later saving is the database storage: 100 GB down to 20 GB would save about $9.20 a month, but RDS cannot shrink storage in place, so it needs a planned move.

## 4. How it was done, in order

1. **Plan and load test (19 to 21 Nov 2026).** #304: the plan, the Terraform stack and the load test, as a proposal. The stack ran once in the NASA account as `staging` (direct mode, a real `t4g.micro`, its own test database with fake data), and was destroyed again (about $0.20). That run found and fixed three bootstrap bugs and sized the instance.
2. **Code changes in `develop`, each reviewed by the other owner:**

   | PR | What it did |
   |---|---|
   | #309 | VPC peering to the default VPC, and the `SCHEDULED_JOBS_ENABLED` switch. |
   | #310 | The staging load test, `t4g.micro` sizing, the bootstrap fixes, `GET /healthz`. |
   | #312 | `scripts/copy-env-to-ssm.py`: copies a `.env` into SSM (dry run by default; prints names and lengths, never values). |
   | #313 | Writes production settings so the app reads them unchanged. |
   | #315 | The copy script checks each value with the server's own `render-env.cjs`, so the script and the boot cannot disagree. |
   | #316 | Values of 4 to 8 KB (the database certificate chain) go to SSM's advanced tier. |
   | #311, #314, #318 | Releases of `develop` into `main` (tooling only, so `main` equals `develop`). |
   | #317 | Journal entry for the apply. |
   | #319 | The cutover runbook. |
   | #320 | Fix to the first pre-check (the `.env` stores `PORT='3251'` with quotes). |
   | #321 | Runbook fixes and the cutover journal entry (Caddy `restart`, the new rollback order). |

   Application code differs from the old server's version in only three files (`app.js`, a rate-limit helper that does nothing in production, `.env.example`): the health route and the jobs switch. Nothing in pay, Everee or QuickBooks code changed.
3. **Backups (21 Nov).** A manual RDS snapshot and a snapshot of the old server's root disk.
4. **Settings copy.** Dry run on the real `.env` (43 passed, one refused because the database certificate chain is 4,576 bytes), then #316, then `--apply`: 44 written, 0 failed, jobs switch forced to `false`. The `.env` copy was deleted straight after.
5. **Apply (21 Nov), in the order both owners agreed.** Only the release bucket first (`-target`, 5 resources), upload the release built from `main`, then the full apply: 69 added, 0 changed, 0 destroyed. A normal plan right after said "No changes". Checks: peering active, the database group has the new rule next to the old one, the instance in `us-east-1a`, SSM online, `/healthz` ok, "Scheduled jobs are off", "Database connected" over the peering. One `Redis client error ... ECONNRESET` seven seconds after boot was a one-off (a direct test from the instance got `PONG`), not an allow-list problem.
6. **Pre-checks (24 Nov).** Both servers well, ports 80 and 443 open to everyone, no `api-new` in any setting, the jobs setting a `SecureString` set to `false`, a dry run of the IP move that would succeed, a fresh RDS snapshot `nasa-pre-cutover-2026-11-24`, and a quiet check of the old server's log.
7. **The cutover (24 Nov, times in IST; US Central is 30 minutes ahead of 12:00):**

   | Time | Step and result |
   |---|---|
   | 12:16 | Jasil's written "go" in the Slack thread. |
   | 12:21:07 | Step 1: `pm2 stop nasa-backend` on the old server (the last user request it served was at 12:05:23). |
   | 12:21:38 | Step 2: the old Elastic IP moved to the new instance. The spare IP detached itself and the instance kept a public address (SSM kept working). |
   | 12:22:26 | Step 3: the Caddyfile name changed to `api.nasaroutes.com` and Caddy restarted. Certificate obtained 12:22:32. |
   | 12:22:38 | Step 4: `https://api.nasaroutes.com/healthz` returned ok from the new server. |
   | 12:24 to 12:33 | Step 5: admin and driver sign-in, dashboard, the Insights connector and the QuickBooks panel all worked, with no errors in the log. First user request on the new server: 12:24:17. |
   | 12:35:52 | Step 6b: `ReplaceUnhealthy` suspended (see section 6). |
   | 12:35:58 to 12:36:02 | Step 7: jobs switched on in SSM and `.env`, the app restarted (about 4 seconds down). "Scheduled jobs are on". |
   | 12:45, 13:15 | First "Everee payments checked" lines (2 checked, the same as the old server). |
   | 13:16:49 | The old instance stopped (not terminated), after termination protection was turned on and its root disk snapshotted. |

   **Downtime: HTTPS to `api.nasaroutes.com` failed from 12:21:07 to 12:22:32, about 1 minute 25 seconds** (first confirmed good response at 12:22:38). No user request appears in either server's log inside that gap (it was 12:51 AM in Texas). A failed request does not reach an app log, so this says none was served, not that none failed. Nothing else interrupted service; the 12:36 restart was about 4 seconds and Caddy logged no upstream errors.
8. **What differed from the plan.**
   - `systemctl reload caddy` is not applicable on this Caddy unit, so Caddy was restarted (certificates are kept). The runbook now says `restart`.
   - The first pre-check read `PORT='3251'` with its quotes and printed nothing; fixed in #320 before the window.
   - The Redis reset right after the first boot was a one-off, not a block.
   - The payment job runs every 15 minutes but re-checks an item only when its last check is *more than* 15 minutes old, so with pending payments it logs about every 30 minutes, not every 15. The onboarding sync logs only when workers are in onboarding.
   - The old instance is stopped, not left running (a reboot would have started its app by itself, because PM2 is enabled at boot there, and run a second set of jobs).

## 5. Rollback

**Order (never change it; the app reads the jobs switch once at start-up, so the new server must be off before the old one starts):**
1. Set `/nasa/prod/SCHEDULED_JOBS_ENABLED` to `false` in SSM, set it to `false` in the new server's `.env`, run `systemctl stop nasa-backend` and confirm it is `inactive` with no new log lines. (If SSM cannot reach it: suspend the group's `ReplaceUnhealthy` and `Launch` processes and stop the instance from AWS.)
2. Start the old instance and wait for its status checks. It gets a new automatic public address.
3. Move the Elastic IP back to the old instance (from the console or CLI; no access to the old server is needed), then SSH in and run `pm2 start nasa-backend` if it is not already online. Expect "Database connected".
4. Check the site (admin and driver sign-in). Later, put the spare IP back on the new server so it has a public address.

Exact commands: [`CUTOVER_RUNBOOK.md`](CUTOVER_RUNBOOK.md) section 4. If the *data* is wrong (not just the server), do not restore a snapshot on your own: stop and talk first, because a restore loses what was written since it was taken.

**When it stops being possible, or becomes a bigger job:**
- The old instance is terminated. Its disk would then come from the snapshot or an image, which is a rebuild, not a rollback. Do not delete it before the conditions in section 6.
- The old 5432 rule on the database group is removed. The old server could no longer reach the database.
- A database change that the old code cannot read is applied (for example a pending migration for new reporting columns). Check before applying anything like that.
- The Terraform follow-up has moved the old Elastic IP into Terraform. Moving it back is then a change Terraform would see as drift. Do it, then tell the other owner and reconcile in the next plan.
- Real time passes: the longer the new server runs, the more data (pay runs, uploads) was written through it. Rollback does not undo data, it only points traffic back.

## 6. What is next, with owners

Owners are proposals; change them as the two of you agree. "Read" means both read the plan or the exact change before anything is applied.

| # | Item | Owner | Notes |
|---|---|---|---|
| 1 | **Rollback-week monitoring** | Both | Watch errors, CPU and CPU credits daily. Cover one full week's cycle: the weekly Excel upload, a pay run and the Sunday availability reset. Check Everee's webhook delivery log for failures around 12:21 to 12:22 on 24 Nov and resend any. |
| 2 | **Terraform follow-up** (one plan, in a quiet window, both read it) | Jayasoorya writes, both read | Import the old Elastic IP into Terraform, release the spare one, set `api_domain = "api.nasaroutes.com"`, apply, then resume `ReplaceUnhealthy`. Until then: the new server's Caddyfile has one hand edit, `ReplaceUnhealthy` is suspended, and **a replaced instance would start with the old startup script: it would take the spare IP and serve the test name, so `api.nasaroutes.com` would be down.** Do not apply anything else meanwhile. Changing `api_domain` changes the startup script, so the group replaces the instance (a few minutes down); the jobs still run on one server only. |
| 3 | **Delete the old instance and the old 5432 rule** | Jayasoorya, Jasil reads the security group change | Only when: the new server has run cleanly for about 7 days (including the cycle in item 1); item 2 is applied; nothing on the old disk matters (checked on 24 Nov: no `uploads` folder, no cron jobs, only the `api` nginx site; the old `.env` stays private). Then: snapshot its disk (or an image) and keep it about 30 days, turn off termination protection, terminate, then remove the old rule ("Allow EC2 backend") from the database security group and delete the old server's security group (closes the open SSH port). |
| 4 | **Dedicated database user for the app, and rotate `JWT_SECRET`** | Jayasoorya | The app connects as the database master user today. Rotating `JWT_SECRET` signs everyone out, so do it in a quiet window. Also rotate the secrets that were exposed while copying settings (Everee token and webhook key, QuickBooks secret and key, database and Redis passwords, Cloudinary secret). |
| 5 | **GoDaddy access** | Jayasoorya | Find whose account holds `nasaroutes.com` (registered with privacy protection) and get a sign-in or delegate access. Needed for renewals and any future DNS change. Not needed for operating the setup. |
| 6 | **A single-runner lock for the jobs** | Jayasoorya (code), Jasil reads | Before ever raising `asg_max` above 1 (database advisory lock or a flag). |
| 7 | **Move the Excel upload to a background worker** | Jasil (reserved files) | The weekly upload blocks Node's event loop for about 16 seconds on a micro. A bigger instance does not fix it. |
| 8 | **Later savings** | Both | The RDS CA bundle instead of the stored certificate chain; `db.t4g.micro` (about $1.50 a month); shrinking the database storage from 100 GB to 20 GB (about $9.20 a month; needs a planned move). |
| 9 | **Clean up old RDS snapshots** | Jayasoorya, Jasil reads the list | Keep the ones for this move until item 3 is done. |
| 10 | **IAM tidy-up** | Both | Replace the temporary AdministratorAccess group with a narrower policy, give Jasil his own sign-in with MFA, review the idle `nasa-logistics` user. |

## 7. Operations

All commands use the NASA AWS profile (`export AWS_PROFILE=nasa AWS_REGION=us-east-1`; renew with `aws login --profile nasa`). Look up the instance ID instead of writing it down: it is the one instance in the Auto Scaling group `nasa-prod-app`. The settings and logs hold secrets: never paste values into chat, issues or the repository.

**Read logs through Session Manager (no SSH).** Open a shell: `aws ssm start-session --target <instance-id>` (needs the `session-manager-plugin`). Or run one command without a shell: `aws ssm send-command --document-name AWS-RunShellScript ...` (the runbook's `run_on_new` helper wraps this). On the instance:
- App: `journalctl -u nasa-backend --no-pager | tail -50`. The start-up line "Scheduled jobs are on/off" is logged once.
- HTTPS: `journalctl -u caddy --no-pager | tail -50`.
- First boot: `/var/log/nasa-bootstrap.log` (ends with "bootstrap finished").

**Change a setting.** The `.env` is rendered from SSM only at boot. So (1) change the value in SSM: `aws ssm put-parameter --name /nasa/prod/<NAME> --type SecureString --value '...' --overwrite` (use the same type as before; check with `get-parameter`, never print the value), and (2) while the instance is not rebuilt, make the same edit in `/opt/nasa/Backend/.env` and run `systemctl restart nasa-backend`. A future replaced instance then renders the same value from SSM. If both disagree, the next boot wins with the SSM value.

**Deploy a new release.** Build and upload: `docs/infra/scripts/package-backend.sh <release-bucket>` (the bucket name is `terraform output artifact_bucket`). Then:
- *After item 2 of section 6 is applied:* `aws autoscaling start-instance-refresh --auto-scaling-group-name <group>`. The group replaces the instance with one that starts from the new release (a few minutes down, because it is one instance).
- *Until then, do not start an instance refresh* (a replacement would take the spare Elastic IP and serve the test name). The interim in-place route is the steps the bootstrap itself performs: download `backend-latest.tgz` from the release bucket, unpack it over `/opt/nasa/Backend` without touching `.env`, `npm ci --omit=dev`, `systemctl restart nasa-backend`. **This route has not been used yet. Agree the first use with the other owner and check `/healthz` and the log straight after.**

**Alarms (emailed to the alert address through SNS).**

| Alarm | Fires when | What to do |
|---|---|---|
| `nasa-prod-cpu-high` | CPU above 80% for 15 minutes | Check the log for a stuck job or upload, and the CPU credit balance (`CPUCreditBalance`; it was 288 and stable on 24 Nov; unlimited mode bills any surplus). If a weekly upload is running, it usually clears. |
| `nasa-prod-no-instances` | Fewer than 1 healthy instance for 5 minutes | The site is down. Check the instance state and `systemctl is-active nasa-backend caddy` through SSM. While `ReplaceUnhealthy` is suspended the group will **not** replace an unhealthy instance by itself: follow `CUTOVER_RUNBOOK.md` section 5 (recovery), or restart the service. |
| Budget (80% actual, 100% forecast of $50) | Spend rising | Look for surplus CPU credits, an unplanned instance or load balancer, and the idle spare Elastic IP. |
| `alb-5xx`, `alb-unhealthy-hosts` | Only exist when `enable_alb = true` | Not used today. |

**Health checks.** `curl -sS https://api.nasaroutes.com/healthz` returns `{"status":"ok"}` only from the new server (the old one has no such route). Status of the group: `aws autoscaling describe-auto-scaling-groups`. Which processes are suspended: the same call, `SuspendedProcesses` (today only `ReplaceUnhealthy`).

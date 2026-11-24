# Backend deploy runbook

Status: **proposal, to be read by both owners before the first deploy.** Written 2026-11-25. Neither route below has been used in production yet. The first real use is also the recovery drill (route A) or the first folder swap (route B): do it in a quiet window with both owners present, and fix this file from what it shows.

**Why.** Before the move, a deploy was `git pull` and a PM2 restart over SSH. The new server does not read from GitHub and has no PM2. It runs a packed copy of the backend from the release bucket. Merging to `main` changes nothing on the server by itself; a person has to pack, upload and roll out the code. The frontend is on Vercel and is not covered here.

## 1. Rules

1. **Deploy what is on `main`.** The package is built from a git ref. Use `origin/main` after `git fetch`, and check that the short commit it prints is the merge you meant to ship.
2. **Uploading is already a change.** `backend-latest.tgz` is what *any* new instance installs, including one the group builds on its own after a failure. Upload only code you are ready to run. Every upload also keeps its own copy, `backend-<commit>.tgz`, so the previous build is never lost.
3. **Both owners say "go"** for the first uses, as at the cutover. Afterwards the person deploying tells the other first.
4. **Quiet window.** Start just after a scheduled Everee check (at :15 or :45 IST). Not during a pay run, and not while a weekly Excel upload is running. A deploy restarts the app, so a running upload would be cut off.
5. **No value is typed in chat, a pull request or a log.** Settings are changed as in `SECRET_ROTATION_RUNBOOK.md`.

## 2. Before you deploy

1. **Database changes first, by hand.** The deploy never runs a migration. If the change has a `Backend/migrations/*.sql` file, run it on the database before the code, and check its rollback file exists. The old code must keep working with the new tables or columns (add first, remove in a later release), because the old code is still running until the rollout.
2. **New settings first.** The server's `.env` is built from SSM (`/nasa/prod/*`), not from the repository. If the change reads a new environment variable, put it into SSM first (steps C and D of `SECRET_ROTATION_RUNBOOK.md`). Otherwise the new code starts without it. Check the pull request and journal entry for "new setting".
3. **Check the state.** `curl -sS https://api.nasaroutes.com/healthz` says ok, both alarms are OK, and the last Everee check ("Everee payments checked") in the log is recent.
4. **Save the logs you want to keep.** Logs live only in the server's journal. Route A deletes them with the old instance; route B keeps them.

## 3. Pack and upload (both routes)

```bash
export AWS_PROFILE=nasa AWS_REGION=us-east-1 AWS_PAGER=""
git fetch origin && git log -1 --oneline origin/main        # the commit you are about to ship
source ~/cutover-ids.env                                    # for $ASG and $NEW_INSTANCE; look them up from the group if the file is gone
BUCKET=$(cd docs/infra/terraform && terraform output -raw artifact_bucket)
docs/infra/scripts/package-backend.sh "$BUCKET" origin/main
```

The script prints the short commit. Write it down: it is the name of the rollback copy of *this* release, and the name of the previous one is in the bucket (`aws s3 ls "s3://$BUCKET/releases/"`).

## 4. Route A: replace the instance (the clean way)

The group terminates the old instance and builds a new one from the new release, with settings rendered from SSM, the same Elastic IP and a fresh certificate request. **A few minutes of downtime** (one instance, and two overlapping instances would run the scheduled jobs twice). Logs on the old instance are lost.

```bash
aws autoscaling start-instance-refresh --auto-scaling-group-name "$ASG"
aws autoscaling describe-instance-refreshes --auto-scaling-group-name "$ASG" --query 'InstanceRefreshes[0].[Status,PercentageComplete]' --output text
```

Do not cancel it. Watch until the status is `Successful`, then check section 6. If the new instance is not healthy in 10 minutes, tell the other owner and follow `CUTOVER_RUNBOOK.md` section 5. This route is the recovery drill, so its first use is agreed in advance and written up.

## 5. Route B: swap the folder on the running instance (interim, for an urgent fix)

Same code, a restart of seconds instead of minutes, logs kept. **Never unpack over the running folder**: files the new release removed would stay behind. Replace `<commit>` with the short commit from section 3. Run it through Session Manager (`aws ssm start-session --target "$NEW_INSTANCE"`) or `run_on_new` from `CUTOVER_RUNBOOK.md` section 0, as root.

```bash
set -euo pipefail
BUCKET=<the release bucket>
D=/opt/nasa/release-$(date +%Y%m%d%H%M)
mkdir "$D"
aws s3 cp "s3://$BUCKET/releases/backend-<commit>.tgz" /tmp/rel.tgz     # the exact commit, not "latest"
tar -xzf /tmp/rel.tgz -C "$D"
(cd "$D/Backend" && npm ci --omit=dev)
install -m 600 /opt/nasa/Backend/.env "$D/Backend/.env"
chown -R ec2-user:ec2-user "$D"
mv /opt/nasa/Backend /opt/nasa/Backend.prev && mv "$D/Backend" /opt/nasa/Backend
systemctl restart nasa-backend
APP_PORT=$(grep -E '^PORT=' /opt/nasa/Backend/.env | head -1 | cut -d= -f2 | tr -d "'\"")
for _ in $(seq 1 30); do curl -fsS -m 3 "http://127.0.0.1:$APP_PORT/healthz" >/dev/null 2>&1 && echo healthz ok && break; sleep 2; done
```

If the log or `/healthz` is wrong, **revert at once**: `systemctl stop nasa-backend; mv /opt/nasa/Backend /opt/nasa/Backend.bad; mv /opt/nasa/Backend.prev /opt/nasa/Backend; systemctl start nasa-backend`. Delete `Backend.prev` and the `release-*` folder after a few clean days. Because the instance was not rebuilt, the next *boot* installs `backend-latest.tgz`, which is the same code as long as section 3 was done first.

## 6. Check afterwards (both routes)

- `curl -sS https://api.nasaroutes.com/healthz` says ok; the group has one instance, InService; both alarms OK.
- App log: no ERROR, and the start-up line "Scheduled jobs are on" appears once (`journalctl -u nasa-backend --no-pager | tail -50`).
- The next Everee check logs normally. Only one instance runs the jobs.
- Open one page that reads the database in the admin panel.
- Write a journal entry with the time, the commit and the route used.

## 7. Rolling back a bad release

- **Route B:** the revert above, in seconds.
- **Route A:** put the previous build back as `latest` and refresh again: `aws s3 cp "s3://$BUCKET/releases/backend-<previous commit>.tgz" "s3://$BUCKET/releases/backend-latest.tgz"`, then section 4. A database change is rolled back with its own rollback SQL, not by this.

## 8. What is tested and what is not

`package-backend.sh` and the boot script that installs `backend-latest.tgz` were used at the cutover. **Not tested:** a refresh on production (the recovery drill, planned), the route B swap, and the revert. The commands are written from the boot script and `VPC_MIGRATION.md` section 7 and are read-only until a person runs them.

## 9. Later

A deploy is manual and needs a person with AWS access. When deploys get frequent, consider a GitHub Action with a deployer role that packs on merge to `main` (the role would need S3 write and refresh rights only). Not built, not part of this runbook.

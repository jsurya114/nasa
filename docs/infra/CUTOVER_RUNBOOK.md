# Cutover runbook: old server to the new AWS server

Status: written 2026-11-24 for the window **Tuesday 24 November 2026, 12:00 IST** (12:30 AM US Central, 1:30 AM US Eastern). Agreed by Jasil and Jayasoorya in the Slack thread. Background and design: [AWS_NETWORK_PLAN.md](AWS_NETWORK_PLAN.md) and [terraform/README.md](terraform/README.md).

**What this does.** `api.nasaroutes.com` already points at the old server's Elastic IP. The cutover moves that Elastic IP onto the new server, so no DNS record changes (DNS is at GoDaddy and we have no sign-in). Expect about 1 to 3 minutes of errors while the old app is stopped, the address moves and the new server gets its HTTPS certificate. The old server is not changed or deleted; it stays stopped as the fallback.

**Rules for the window**
- Jayasoorya and Jasil are both online. Jasil confirms "go" in the Slack thread before step 1.
- Nothing here is pasted into Slack with a value in it. No secrets in commands or notes.
- The scheduled jobs (hourly availability reset, Everee payment check, Everee onboarding sync) have no lock across servers. They run on **one** server at a time. They are off on the new server until step 7.
- Any step that does not give the stated result: stop, say so in the thread, and decide between fixing and rolling back (section 4). Do not improvise.

## 0. Set up the shell (laptop, once)

```bash
export AWS_PROFILE=nasa AWS_REGION=us-east-1 AWS_PAGER=""
aws login --profile nasa            # when the session has expired
aws sts get-caller-identity --query Account --output text   # must print the NASA account number

OLD_IP=$(dig +short api.nasaroutes.com | head -1)
OLD_ALLOC=$(aws ec2 describe-addresses --public-ips "$OLD_IP" --query 'Addresses[0].AllocationId' --output text)
OLD_INSTANCE=$(aws ec2 describe-addresses --public-ips "$OLD_IP" --query 'Addresses[0].InstanceId' --output text)
ASG=$(aws autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[?starts_with(AutoScalingGroupName,'nasa-prod')].AutoScalingGroupName | [0]" --output text)
NEW_INSTANCE=$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$ASG" --query 'AutoScalingGroups[0].Instances[0].InstanceId' --output text)
NEW_ALLOC=$(aws ec2 describe-addresses --filters Name=instance-id,Values="$NEW_INSTANCE" --query 'Addresses[0].AllocationId' --output text)
NEW_IP=$(aws ec2 describe-addresses --allocation-ids "$NEW_ALLOC" --query 'Addresses[0].PublicIp' --output text)
echo "old: $OLD_INSTANCE $OLD_ALLOC $OLD_IP"; echo "new: $NEW_INSTANCE $NEW_ALLOC $NEW_IP"
[[ "$OLD_IP" =~ ^[0-9.]+$ ]] || echo "STOP: api.nasaroutes.com did not resolve to a plain IP address"

# Save the IDs in a private file OUTSIDE the repository (instance IDs and addresses are not secrets, but keep them private).
umask 077
printf 'OLD_IP=%s\nOLD_ALLOC=%s\nOLD_INSTANCE=%s\nASG=%s\nNEW_INSTANCE=%s\nNEW_ALLOC=%s\nNEW_IP=%s\n' \
  "$OLD_IP" "$OLD_ALLOC" "$OLD_INSTANCE" "$ASG" "$NEW_INSTANCE" "$NEW_ALLOC" "$NEW_IP" > ~/cutover-ids.env

# Run a script on the new server through SSM (no SSH). The script is base64-encoded so quotes and brackets survive.
run_on_new() {
  local b64 id
  b64=$(printf '%s' "$1" | base64 | tr -d '\n')
  id=$(aws ssm send-command --instance-ids "$NEW_INSTANCE" --document-name AWS-RunShellScript \
    --parameters "commands=[\"echo $b64 | base64 -d | bash\"]" --query Command.CommandId --output text)
  sleep 3; aws ssm wait command-executed --command-id "$id" --instance-id "$NEW_INSTANCE" 2>/dev/null
  aws ssm get-command-invocation --command-id "$id" --instance-id "$NEW_INSTANCE" \
    --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
}
```

**Run the lookup lines once, before step 2. Never run them again after step 2.** After the move they return the new server as "old", and a rollback would move the address to the server it is meant to leave. In a new terminal (for example after `aws login`), load the saved IDs instead: `source ~/cutover-ids.env`, and paste the `run_on_new` function again. Delete `~/cutover-ids.env` when the cutover is finished.

Check: `OLD_INSTANCE` is the old server (`t3.micro`), `NEW_INSTANCE` is the `t4g.micro` in the group, and no value prints as `None`. Write the four IDs and the two IPs into your own notes, not into the chat or the repository.

## 1. Before the window (from 11:00 IST)

1. **Both servers are well.** New server, through SSM:
   ```bash
   run_on_new 'systemctl is-active nasa-backend caddy; P=$(grep "^PORT=" /opt/nasa/Backend/.env | cut -d= -f2 | tr -d "\047"); curl -s http://127.0.0.1:$P/healthz; echo; journalctl -u nasa-backend --no-pager | grep "Scheduled jobs" | tail -1 | cut -c1-120'
   ```
   Expect `active active`, `{"status":"ok"}` and the last start-up line "Scheduled jobs are off" (the app logs it only at start-up, so do not limit the time). Old server (SSH as before): `pm2 status` shows `nasa-backend` online.
2. **Ports 80 and 443 are open to everyone on the new server** (needed for the certificate the moment the IP lands):
   ```bash
   SG=$(aws ec2 describe-instances --instance-ids "$NEW_INSTANCE" --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text)
   aws ec2 describe-security-groups --group-ids "$SG" --query 'SecurityGroups[0].IpPermissions[?FromPort==`80`||FromPort==`443`].[FromPort,IpRanges[].CidrIp]' --output text
   nc -vz -w 5 "$NEW_IP" 80; nc -vz -w 5 "$NEW_IP" 443
   ```
   Expect `0.0.0.0/0` for both ports and both `nc` calls succeed.
3. **No setting still names the test host** (`api-new`), which would break the Insights connector, the QuickBooks sign-in or CORS right after the cutover. Nothing prints a value:
   ```bash
   run_on_new 'grep -c "api-new" /opt/nasa/Backend/.env || true'        # must print 0
   aws ssm get-parameters-by-path --path /nasa/prod --recursive --with-decryption \
     --query 'Parameters[?contains(Value, `api-new`)].Name' --output text   # must print nothing
   aws ssm get-parameter --name /nasa/prod/SCHEDULED_JOBS_ENABLED --query 'Parameter.[Type,Value]' --output text   # SecureString  false
   ```
   If a setting names the test host, correct it in SSM and in the `.env` and restart the new server with the jobs still off, before the window. If the type is not `SecureString`, change the `put-parameter` type in step 7 and the rollback to match. These SSM values were written by the copy script and are not Terraform resources, so a Terraform `apply` does not reset them.
4. **A fresh database snapshot** (about 10 minutes; wait for `available`):
   ```bash
   SNAP=nasa-pre-cutover-2026-11-24
   aws rds create-db-snapshot --db-instance-identifier database-1 --db-snapshot-identifier "$SNAP" --query 'DBSnapshot.Status' --output text
   aws rds wait db-snapshot-available --db-snapshot-identifier "$SNAP" && echo snapshot-ready
   ```
5. **Permission check, nothing changes:**
   ```bash
   aws ec2 associate-address --dry-run --allocation-id "$OLD_ALLOC" --instance-id "$NEW_INSTANCE" --allow-reassociation 2>&1 | tail -1
   ```
   Expect `DryRunOperation` (it means "would have succeeded").
6. **Information, not a gate** (rollback no longer depends on the old server keeping an address, because the IP is moved back from the console first): does the old instance get its own public address? `aws ec2 describe-subnets --subnet-ids $(aws ec2 describe-instances --instance-ids "$OLD_INSTANCE" --query 'Reservations[0].Instances[0].SubnetId' --output text) --query 'Subnets[0].MapPublicIpOnLaunch'`.
7. **Quiet check.** On the old server: `pm2 logs nasa-backend --lines 40 --nostream`. Few requests, no upload or payment run in progress (the weekly GOFO upload and the Everee runs are the ones to avoid). Jasil and Jayasoorya agree it is quiet.
8. **Go / no-go** in the Slack thread: snapshot ready, both servers well, ports open, quiet. No-go: stop here, nothing has changed.

## 2. Cutover (about 5 minutes)

Write the time of each step in the thread.

**Step 1. Stop the app on the old server.** SSH to it (`ssh ubuntu@api.nasaroutes.com`, the same key as always):
```bash
pm2 stop nasa-backend && pm2 status        # status: stopped
```
Do this before step 2: once the IP moves, the old server cannot be reached by SSH. From here users see errors until step 4.

**Step 2. Move the old Elastic IP to the new server** (laptop):
```bash
aws ec2 associate-address --allocation-id "$OLD_ALLOC" --instance-id "$NEW_INSTANCE" --allow-reassociation
aws ec2 describe-addresses --allocation-ids "$OLD_ALLOC" --query 'Addresses[0].[InstanceId,PublicIp]' --output text   # new instance, same IP as before
aws ec2 describe-addresses --allocation-ids "$NEW_ALLOC" --query 'Addresses[0].[InstanceId,PublicIp]' --output text   # the spare is now unattached
```
The new server keeps a public address (the moved IP), so SSM keeps working. If the spare is still attached, stop and ask before going on. **From now on use only the saved IDs (`source ~/cutover-ids.env`). Do not run the section 0 lookups again.**

**Step 3. Make Caddy serve the real name.** Until now the new server's Caddy answers for the test name; change it to `api.nasaroutes.com` and **restart** Caddy (Caddy then asks Let's Encrypt for a certificate, normally within a minute). Use `restart`: on this server `systemctl reload caddy` fails with "Job type reload is not applicable for unit caddy.service" (the unit has no reload command; found in the real cutover):
```bash
run_on_new 'grep -n "^api" /etc/caddy/Caddyfile; sed -i "s/^api-new\.nasaroutes\.com {/api.nasaroutes.com {/" /etc/caddy/Caddyfile; /usr/local/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -1; systemctl restart caddy; sleep 25; journalctl -u caddy --since "-2min" --no-pager | grep -iE "certificate obtained|error" | tail -5'
```
Expect "Valid configuration" and "certificate obtained successfully". Read the first line of the output **before** step 4: if it did not show `api-new.nasaroutes.com {`, the `sed` changed nothing, so stop and read the Caddyfile.

**Step 4. Check the new server answers as `api.nasaroutes.com`** (laptop):
```bash
curl -sS https://api.nasaroutes.com/healthz ; echo
curl -sSI https://api.nasaroutes.com/healthz | head -1
```
Expect `{"status":"ok"}` and `HTTP/2 200`. This route exists only on the new server (the old one has no `/healthz`), so it proves who is answering. If the certificate is not ready after 3 minutes, check `journalctl -u caddy` for the reason. A rate-limit or port-80 error means rollback (section 4).

**Step 5. Check the app** with Jasil: admin sign-in, a driver sign-in, the dashboard loading real numbers, one page that reads the database. Now also test what needed the real name: the Insights connector and the QuickBooks connection page. Watch the log for errors: `run_on_new 'journalctl -u nasa-backend --since "-5min" --no-pager | grep -ciE "error|ECONN"'`.

**Step 6. Decide.** All of step 5 good: carry on to step 7. Anything wrong that is not a one-minute fix: roll back now (section 4).

**Step 6b. Stop the group replacing the instance by itself until the Terraform follow-up.** A replacement instance would start from the old startup script: it would take the spare address and serve the test name, and `api.nasaroutes.com` would be down. The existing alarms (error and CPU) still email the alerts address.
```bash
aws autoscaling suspend-processes --auto-scaling-group-name "$ASG" --scaling-processes ReplaceUnhealthy
aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$ASG" --query 'AutoScalingGroups[0].SuspendedProcesses[].ProcessName' --output text
```
Resume it in the follow-up (`aws autoscaling resume-processes ... --scaling-processes ReplaceUnhealthy`), after the plan has been applied.

**Step 7. Turn the scheduled jobs on for the new server** (the old server is stopped, so there is exactly one runner):
```bash
aws ssm put-parameter --name /nasa/prod/SCHEDULED_JOBS_ENABLED --type SecureString --value true --overwrite --query Version --output text
run_on_new 'sed -i "s/^SCHEDULED_JOBS_ENABLED=.*/SCHEDULED_JOBS_ENABLED=true/" /opt/nasa/Backend/.env; grep -c "^SCHEDULED_JOBS_ENABLED=true$" /opt/nasa/Backend/.env; systemctl restart nasa-backend; sleep 15; systemctl is-active nasa-backend; journalctl -u nasa-backend --since "-1min" --no-pager | grep -E "Scheduled jobs|Database connected"'
```
Expect `1`, `active`, "Scheduled jobs are on". Then `curl -sS https://api.nasaroutes.com/healthz`. The SSM value keeps the setting after any future restart or replacement.

## 3. Watch (the rest of the day)

- **Skipped job runs.** No job runs between step 1 (old app stopped) and step 7 (jobs on): about 5 to 15 minutes. The availability reset acts only at Sunday 12:00 local time per time zone, so a Tuesday gap skips nothing. The Everee status check (every 15 minutes) and the onboarding sync (every 5 minutes) look at the current state of unfinished payments and workers each run, so the next run picks up what the gap left. Confirm it by finding "Everee payments checked" in the log after step 7 (within about 30 minutes while payments are pending); a quiet onboarding sync leaves no line. If no payment line appears within 40 minutes and payments are pending, or any `ERROR` appears, tell Jasil.
- Application log on the new server for errors. A job writes a line only when it found something to do: "Everee payments checked" appears when a payment was due for a re-check (the job runs every 15 minutes, but an item is re-checked only when its last check is more than 15 minutes old, so with pending payments the line shows about every 30 minutes), and "Everee onboarding checked" only when workers are in onboarding. No line and no error from a quiet run is fine.
- CloudWatch alarms and the CPU credit balance on the new instance (it starts low and must not fall to zero; unlimited mode bills any extra by the vCPU hour).
- Jasil and Jayasoorya check the dashboard and a driver sign-in again after 1 hour and after 24 hours.
- Note the cutover end time in the thread and write the journal entry.

## 4. Rollback (use Jasil's order)

**Use the saved IDs (`source ~/cutover-ids.env`). Never re-run the section 0 lookups after step 2: they would name the new server as the old one.** Use this rollback if step 4 or 5 fails, or at any time in the first week. After the cutover the old instance is *stopped* (not terminated), so the order is: new server off, start the old instance, move the Elastic IP, start the old app. The order matters: the app reads `SCHEDULED_JOBS_ENABLED` once at start-up, so the new server must be **stopped** before the old one starts, or both would run the jobs.

1. **Set the jobs off for good on the new server** and stop it (laptop):
   ```bash
   aws ssm put-parameter --name /nasa/prod/SCHEDULED_JOBS_ENABLED --type SecureString --value false --overwrite --query Version --output text
   run_on_new 'sed -i "s/^SCHEDULED_JOBS_ENABLED=.*/SCHEDULED_JOBS_ENABLED=false/" /opt/nasa/Backend/.env; systemctl stop nasa-backend; systemctl is-active nasa-backend; date -u +%T; journalctl -u nasa-backend --since "-1min" --no-pager | tail -3'
   ```
   Expect `inactive` and no new log lines after the stop.
   *If the new server cannot be reached through SSM:* stop it from AWS instead. `aws autoscaling suspend-processes --auto-scaling-group-name "$ASG" --scaling-processes ReplaceUnhealthy Launch`, then `aws ec2 stop-instances --instance-ids "$NEW_INSTANCE"` and wait for `stopped` (`aws ec2 wait instance-stopped --instance-ids "$NEW_INSTANCE"`). Resume the processes later.
2. **Start the old instance and wait for its status checks** (it was stopped after the cutover, with termination protection on; it is a normal start from AWS):
   ```bash
   aws ec2 start-instances --instance-ids "$OLD_INSTANCE" --query 'StartingInstances[0].CurrentState.Name' --output text
   aws ec2 wait instance-running --instance-ids "$OLD_INSTANCE"
   aws ec2 wait instance-status-ok --instance-ids "$OLD_INSTANCE" && echo old-instance-ready
   ```
   PM2 is enabled at boot on the old server, so it may start the app by itself. That is why step 1 (new server stopped and confirmed inactive) comes first. The old instance gets a new automatic public address on start; the Elastic IP is not on it yet.
3. **Move the Elastic IP back to the old server, then make sure its app is running:**
   ```bash
   aws ec2 associate-address --allocation-id "$OLD_ALLOC" --instance-id "$OLD_INSTANCE" --allow-reassociation
   aws ec2 describe-addresses --allocation-ids "$OLD_ALLOC" --query 'Addresses[0].[InstanceId,PublicIp]' --output text
   ```
   Then `ssh ubuntu@api.nasaroutes.com` and run `pm2 status`; if `nasa-backend` is not online, `pm2 start nasa-backend`; then `pm2 logs nasa-backend --lines 20 --nostream`. Expect online and "Database connected". (If SSH to the name does not answer yet, use the instance's automatic public DNS name from `aws ec2 describe-instances`.)
4. Check `https://api.nasaroutes.com` from the app (admin and driver sign-in). The old server's own certificate (nginx and certbot) is unchanged.
5. Later, put the spare address back on the new server so it has a public address again: `aws ec2 associate-address --allocation-id "$NEW_ALLOC" --instance-id "$NEW_INSTANCE"` (and resume the group processes if they were suspended). Say what happened in the thread and write a journal entry.

If the database or data is wrong (not just the server): do not restore the snapshot on your own. Stop and talk first: restoring replaces the data written since it was taken.

## 5. If the instance was replaced before the follow-up

Signs: the alarm email, `api.nasaroutes.com` not answering, or `$NEW_INSTANCE` no longer in the group. The replacement takes the spare address and serves the test name. Recover with the saved IDs (the new instance ID comes from the group, as in section 0, and the old address allocation from the file):
1. `NEW_INSTANCE=$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$ASG" --query 'AutoScalingGroups[0].Instances[0].InstanceId' --output text)`; wait until its start-up is done (`run_on_new 'tail -3 /var/log/cloud-init-output.log'` shows "bootstrap finished").
2. Move the old address to it: `aws ec2 associate-address --allocation-id "$OLD_ALLOC" --instance-id "$NEW_INSTANCE" --allow-reassociation`.
3. Redo step 3 (the Caddyfile), then check the settings as in pre-check 3. The jobs: the SSM value is `true`, so the new instance starts them. That is right while the old app stays stopped; confirm with the log.
4. Check `https://api.nasaroutes.com/healthz`, and say what happened in the thread.

## 6. After the cutover (not in the window)

1. **Terraform follow-up, as a plan Jasil and Jayasoorya both read before applying** (journal `2026-11-24-adopt-api-elastic-ip.md` has the plan and the apply steps). In your local, git-ignored `terraform.tfvars`: remove the `api_domain = "api-new..."` line (the default is already `api.nasaroutes.com`) and set `existing_eip_allocation_id` to the old Elastic IP's allocation ID (from `~/cutover-ids.env`, `OLD_ALLOC`). The plan then shows: 1 import (the old address, tags only), the spare address destroyed (it is unattached), the instance's permission pointing at the old address, a new launch template version, and the group's `ReplaceUnhealthy` process resumed. The group uses the launch template's `$Latest` version, so the new version should not replace the running instance by itself; this is not verified, so apply in a quiet window and expect, at worst, a few minutes down (the jobs still run on one server only). Until then the hand edit to the Caddyfile (step 3) is the only difference between the server and the code, and any apply, even an unrelated one, resumes `ReplaceUnhealthy`. Do not apply before both have read the plan.
2. **Release the spare Elastic IP** (the new one, unattached) once Terraform owns the old one. An idle address is billed.
3. **The old instance is stopped, not terminated** (done after the cutover, with termination protection on and a snapshot of its root disk taken first). Delete it only when all of these are true: the new server has run cleanly for about 7 days (including a weekly Excel upload, a pay run and the Sunday availability reset); the Terraform follow-up (item 1) is applied; nothing on the old disk still matters (it had no `uploads` folder, no cron jobs, and only the `api` nginx site; its old `.env` stays private). Then take a final disk snapshot (or an image) and keep it about 30 days, terminate the instance, and afterwards remove the old 5432 rule ("Allow EC2 backend") from the database security group and the old server's security group (this closes the open SSH port). The security group change is a production change: post the exact change for the other owner to read first.
4. **Rotate secrets** once stable: Everee token and webhook key, QuickBooks secret and key, database password, Redis password, Cloudinary secret, JWT secrets. Replace the temporary AdministratorAccess group with a narrower policy, and give Jasil his own sign-in with MFA.
5. Write the cutover journal entry: times, what was checked, what differed from this runbook.

# Secret rotation runbook

Status: **proposal, to be read by both owners before any step is run.** Written 2026-11-25. Nothing in this file changes anything until a person runs it.

**Why.** The old server's `.env` was once pasted into a chat, so every value in it must be treated as exposed. This runbook replaces them one at a time, in quiet windows, without anyone seeing a value.

**Not before the old server is gone.** The old (stopped) server still holds the old values, and it is the rollback copy until about 7 clean days after the cutover. Rotate after `VPC_MIGRATION.md` section 6 item 3 is done, or the rollback would start with passwords that no longer work.

## 1. Rules

1. **No value is ever typed in a chat, a pull request, a log, a command saved in shell history, or this repository.** Values are either generated straight into SSM or pasted into a hidden prompt (`read -rs`). Claude never sees or handles a value; it runs only the commands that contain none.
2. **One secret per window, and both owners say "go"** (same as the cutover and the Terraform apply). Write a journal entry after each one with the time, the setting *name* and the result, never the value.
3. **Back up first** where the section says so. Check `/healthz`, both alarms and the scheduled-job timing (start just after an Everee check, at :15 or :45) before every change.
4. **A secret is not rotated until the old one is revoked** at the provider. Changing SSM alone leaves the exposed value working.

## 2. The order and what each one costs

| # | Settings in SSM (`/nasa/prod/<name>`) | Where the new value comes from | While it changes | Check afterwards |
|---|---|---|---|---|
| 1 | `REPORTING_DB_PASSWORD` | `ALTER ROLE` on the read-only reporting login (a DB admin runs it with a generated value) | NASA Insights data tools are off until the restart. Nothing else. | Ask the NASA Insights connector for the reporting cities. |
| 2 | `CLOUDINARY_API_SECRET` (and `CLOUDINARY_API_KEY` if you make a new key pair) | Cloudinary console | Access-code images fail between the provider change and the restart, so make both within a minute. | Open an access-code image in the admin panel. |
| 3 | `REDIS_PASSWORD` | The Redis provider's console | Redis holds the list of revoked sign-in tokens. Calls to it fail until the restart. | Sign in and out of the admin panel. |
| 4 | `EVEREE_WEBHOOK_SIGNING_KEY` | Everee (Settings, Integrations hub, Webhooks): the key is shown once, when the endpoint is created. Sandbox and production have different keys. | Webhooks are rejected until the new key is in the app. The payment-status job also reads Everee itself, so a missed webhook should be caught; confirm in the log. | Everee's webhook delivery log shows a success; the log shows "Everee payments checked". |
| 5 | `EVEREE_API_TOKEN` | Everee | Everything that talks to Everee fails between the two changes. **Never during a pay run.** | The next "Everee payments checked" line, no ERROR. Do not send a payment to test. |
| 6 | `QUICKBOOKS_CLIENT_SECRET` and `QUICKBOOKS_TOKEN_KEY` together | Intuit developer portal (client secret); a generated 64-hex value (token key) | **The token key encrypts the saved QuickBooks tokens. A new key makes them unreadable, so QuickBooks must be reconnected in the admin panel by the owner, who signs in to QuickBooks themselves.** Do it with the owner at that screen. | The admin panel says QuickBooks is connected to the company again. |
| 7 | `JWT_SECRET` and `REFRESH_TOKEN_SECRET` (two **different** values) | Generated on the spot | **Everyone is signed out**, drivers and admins. The server will not start if either is missing or both are the same. Do it at night in the US. | Sign in as an admin; `/healthz` ok. |
| 8 | `DB_PASSWORD` | RDS master password (the app connects as the master user today) | A short burst of database errors between the change and the restart. Do both within a minute. A fresh RDS snapshot first. | `/healthz` ok, an admin page that reads the database loads, no ERROR in the log. |

Everything else in `/nasa/prod` is a setting or an identifier, not a secret (hosts, names, flags, the Everee tenant ID, the QuickBooks client ID, `DB_USER`). `EXPO_ACCESS_TOKEN` is not set in production.

Windows: 1 to 3 can share a day. 4 and 5 together with Everee's own screens open. 6 with the owner present. 7 and 8 each alone, at night in the US (about 12:00 IST).

## 3. The steps for one setting

Set the shell first (on your own computer):

```bash
export AWS_PROFILE=nasa AWS_REGION=us-east-1 AWS_PAGER=""
source ~/cutover-ids.env      # for $NEW_INSTANCE; look it up from the group if the file is gone
NAME=EVEREE_WEBHOOK_SIGNING_KEY   # the setting you are changing
```

**A. Before.** Check `/healthz`, both alarms, and note the current version number of the setting (not its value), for a rollback:

```bash
aws ssm get-parameter --name /nasa/prod/$NAME --query 'Parameter.Version' --output text
```

**B. Make the new value at the provider** (Everee, Intuit, Cloudinary, the Redis console, RDS or the reporting login), as the row says. Do not close the provider's screen yet.

**C. Put it into SSM without showing it.** Either paste the provider's value into a hidden prompt:

```bash
read -rs VALUE
aws ssm put-parameter --name /nasa/prod/$NAME --type SecureString --value "$VALUE" --overwrite
unset VALUE
```

or, for a value you generate yourself (the JWT secrets and the QuickBooks token key), generate it straight into SSM so nobody sees it:

```bash
VALUE=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")   # token key: VALUE=$(openssl rand -hex 32)
aws ssm put-parameter --name /nasa/prod/$NAME --type SecureString --value "$VALUE" --overwrite
unset VALUE
```

Never run `get-parameter --with-decryption` or print the variable. For setting 6 the client secret comes from Intuit, so it uses the hidden-prompt form; the token key is generated.

**D. Re-render the server's `.env` from SSM and restart.** The script `docs/infra/scripts/rerender-env.sh` uses the same tool as the boot script, so no value is typed on the server. First a dry run: it must name only the setting you just changed.

```bash
B64=$(base64 < docs/infra/scripts/rerender-env.sh | tr -d '\n')
run() { C=$(aws ssm send-command --instance-ids "$NEW_INSTANCE" --document-name AWS-RunShellScript \
  --parameters "commands=[\"echo $B64 | base64 -d > /tmp/rr.sh; bash /tmp/rr.sh $1; rm -f /tmp/rr.sh\"]" \
  --query Command.CommandId --output text); aws ssm wait command-executed --command-id "$C" --instance-id "$NEW_INSTANCE" 2>/dev/null || true
  aws ssm get-command-invocation --command-id "$C" --instance-id "$NEW_INSTANCE" --query StandardOutputContent --output text; }
run ""          # dry run: names of the settings that differ
run "--apply"   # installs the new .env and restarts nasa-backend; waits for /healthz
```

(`SCHEDULED_JOBS_ENABLED` always shows as different until the first `--apply`: it was written by hand without quotes at the cutover. Both forms read the same.) Between the two `run` calls, finish the provider's side if the row says to do both within a minute.

**E. Check** the last column of the table, `/healthz`, the alarms, and 10 minutes of the log with no ERROR line. Then **revoke the old value at the provider** (delete the old key, token or password) and remove the saved copy of the old file on the server:

```bash
aws ssm send-command --instance-ids "$NEW_INSTANCE" --document-name AWS-RunShellScript --parameters 'commands=["rm -f /opt/nasa/.env.before-rotation"]'
```

**F. If it goes wrong.** Put the old value back and re-render. If the old value was in the provider only, keep the provider's old key until the checks pass. If the app does not come back, the script prints the exact command that restores the previous `.env`. The previous SSM value is read from the version you noted, without printing it:

```bash
VALUE=$(aws ssm get-parameter --name /nasa/prod/$NAME:<old version> --with-decryption --query Parameter.Value --output text)
aws ssm put-parameter --name /nasa/prod/$NAME --type SecureString --value "$VALUE" --overwrite; unset VALUE
```

then run D again.

## 4. Notes per setting

- **Database (8).** Snapshot first (`aws rds create-db-snapshot`). Change the master password with `read -rs VALUE` and `aws rds modify-db-instance --db-instance-identifier <the database> --apply-immediately --master-user-password "$VALUE"`, then C and D at once. Open connections keep working until they close, but new ones fail until the restart. When the dedicated app user exists (`VPC_MIGRATION.md` section 6 item 4), rotate that login instead and keep the master password for emergencies.
- **QuickBooks (6).** Change the client secret at Intuit and the token key together, then reconnect. If the panel says "not connected" afterwards, that is expected for the token key; reconnect before any payment run.
- **JWT (7).** Mobile drivers on a route are signed out and must sign in again. Pick the quietest night hour, and tell the drivers' admins first.
- **Everee (4, 5).** The webhook endpoint is `POST /webhooks/everee`. If Everee only lets you create a new endpoint to get a new key, create the new one first, switch the app (C and D), check a delivery succeeds, then delete the old endpoint.

## 5. Afterwards

- Every place that held an old value is now stale: the old server's `.env` (deleted with the old server), local `.env` copies on laptops (replace or delete them), and the old RDS and disk snapshots (the cleanup keeps one for about 30 days: note the end date and delete it).
- Update `VPC_MIGRATION.md` section 6 item 4 and write the journal entries.
- Not covered here: the IAM user and its temporary administrator group, the GitHub and Vercel access, the GoDaddy account and any SSH key. They are separate items in `VPC_MIGRATION.md` section 6.

## 6. What is tested and what is not

Tested on 25 November 2026: the script's dry run on the production server (it re-renders from SSM, names only `SCHEDULED_JOBS_ENABLED` as different, changes nothing, `/healthz` stays ok). **Not tested:** `--apply` (the install and restart) on production, the provider-side steps, and every row's "check afterwards". Run the first rotation on the least risky setting (row 1) and fix this file from what it shows.

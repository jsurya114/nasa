# Saving the server logs before the recovery drill

Status: **proposal, to be read by both owners before it is used.** Written 2026-11-25, from Jasil's conditions in the migration thread. Nothing in AWS exists or changes until the Terraform in this pull request is applied, and that needs both owners.

**Why.** The app and Caddy logs live only in the server's journal (about 32 MB since 21 November). The drill (an instance refresh) deletes them with the old instance. They are the only record of the cutover and the first days, so one compressed copy is kept for a limited time before the drill.

## 1. The place

A separate private bucket, **used for nothing else** (not the state bucket, not the release bucket): `drill_logs.tf`, production only. Public access fully blocked, encrypted (AES256), only encrypted connections, and a lifecycle rule that deletes objects `drill_log_retention_days` after upload (default 35: a drill on 27 November and the old server gone by about 1 December, plus 30 days). When the date the old server is deleted is fixed, change the variable so the file goes about 30 days after it. The server has **no** access to the bucket; nothing writes to it automatically. The bucket name is `terraform output -raw drill_logs_bucket`.

## 2. Save the logs (from the start of the drill window, before the refresh)

Both owners say "go" first. Set the shell as in `CUTOVER_RUNBOOK.md` section 0 (`source ~/cutover-ids.env` for `$NEW_INSTANCE`).

**A. On the server (through SSM): collect, compress, measure.** The file holds the whole journal (every unit) and the first-boot log. Nothing here prints a log line.

```bash
run_on_new 'set -e; umask 077; cd /tmp
journalctl --no-pager -o short-iso | gzip -9 > nasa-journal.log.gz
tar -czf nasa-logs-before-drill.tgz nasa-journal.log.gz -C /var/log nasa-bootstrap.log
rm -f nasa-journal.log.gz
echo "size_bytes=$(stat -c %s nasa-logs-before-drill.tgz)"; echo "sha256=$(sha256sum nasa-logs-before-drill.tgz | cut -d" " -f1)"; echo "md5=$(md5sum nasa-logs-before-drill.tgz | cut -d" " -f1)"'
```

Write the size and the sha256 down (they go in the Slack thread). The app does not log secrets by rule (`ENGINEERING_STANDARD.md` section 3.4); skim nothing, but if anyone ever finds one in a log, tell the team and rotate it.

**B. On the laptop: a pre-signed PUT link that expires in 15 minutes.** It is held only in a shell variable: **never posted, never written to a file.** `aws s3 presign` makes download links only, so use a short throw-away Python environment (the packages are not part of the repository):

```bash
BUCKET=$(cd docs/infra/terraform && terraform output -raw drill_logs_bucket)
KEY="drill/$(date +%F)/nasa-logs-before-drill.tgz"
python3 -m venv /tmp/presign-venv && /tmp/presign-venv/bin/pip install -q boto3
URL=$(/tmp/presign-venv/bin/python - "$BUCKET" "$KEY" <<'PY'
import sys, boto3
s3 = boto3.Session(profile_name="nasa", region_name="us-east-1").client("s3")
print(s3.generate_presigned_url("put_object", Params={"Bucket": sys.argv[1], "Key": sys.argv[2]}, ExpiresIn=900, HttpMethod="PUT"))
PY
)
```

**C. Upload from the server, then check.** The link works for that one object name, for `PUT` only, for 15 minutes. It travels in the SSM command, so it also sits in AWS's command history until it expires; it is useless after that. The link is dropped from the shell and the venv removed straight after the upload; the copy on the server is removed only after the check:

```bash
run_on_new "curl -fsS -m 120 -X PUT --upload-file /tmp/nasa-logs-before-drill.tgz '$URL' && echo uploaded"
unset URL; rm -rf /tmp/presign-venv
aws s3api head-object --bucket "$BUCKET" --key "$KEY" --query '[ContentLength,ETag,ServerSideEncryption]' --output text
# only when the numbers in the next paragraph match, remove the copy on the server (it stays until then, mode 600, in case you must upload again):
run_on_new 'shred -u /tmp/nasa-logs-before-drill.tgz 2>/dev/null || rm -f /tmp/nasa-logs-before-drill.tgz'
```

For a file uploaded in one piece the `ETag` is the file's md5: it must equal the `md5` from step A, and `ContentLength` must equal `size_bytes`. If either differs, upload again (new link); do not start the refresh until they match.

**D. Record it.** Post the size and sha256 in the Slack thread, and write the bucket, the key and the expiry date (location only, never contents) in the drill's journal entry. Do not download the file back to a laptop except to read a specific time period, and delete that copy afterwards.

## 3. After

- The file expires by itself. Check the bucket is empty after the date, and when the old server is deleted, check the variable still fits (section 1).
- Next step, its own pull request after the drill (Jasil): send the app and Caddy logs to CloudWatch with 14 days' retention, so the next refresh does not delete them. The cost goes in that pull request.

## 4. What is tested and what is not

`terraform validate`, `terraform test` (16 passed, three of them for this bucket) and a real `terraform plan` against production: 5 to add, 0 to change, 0 to destroy. **Not tested:** the commands in section 2 (the bucket does not exist yet; test the upload with a small dummy file as soon as the bucket is applied, and fix this file from what it shows), and the presign step.

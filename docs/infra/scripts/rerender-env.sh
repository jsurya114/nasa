#!/usr/bin/env bash
# Re-render /opt/nasa/Backend/.env from SSM (/nasa/prod) with the same tool as the boot script, so a changed
# setting reaches the app without anyone typing a value on the server. It prints setting NAMES only, never values.
#
# Run on the production server as root (through SSM send-command, see SECRET_ROTATION_RUNBOOK.md):
#   rerender-env.sh            dry run: shows which settings differ from the live .env, changes nothing
#   rerender-env.sh --apply    installs the new .env (mode 600, owner ec2-user), restarts nasa-backend, waits for /healthz
#
# --apply keeps the previous file as /opt/nasa/.env.before-rotation (mode 600) so a failed change can be undone.
# Delete that file once the checks are done: it holds the old values.
set -euo pipefail
umask 077

APP=/opt/nasa/Backend
REGION=${AWS_REGION:-us-east-1}
cd "$APP"

NODE_BIN=$(command -v node)
PORT_LINE=$(grep -E '^PORT=' .env | head -1 || true)
if [ -z "$PORT_LINE" ]; then
  echo "ERROR: no PORT= line in $APP/.env (or no .env). Nothing was changed." >&2
  exit 1
fi
APP_PORT=$(printf '%s' "$PORT_LINE" | tr -d "'\"")
APP_PORT=${APP_PORT#PORT=}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

aws ssm get-parameters-by-path --region "$REGION" --path /nasa/prod --with-decryption --recursive \
  --output json > "$WORK/ssm.json"
# render-env.cjs loads the app's own dotenv, so it must run from the app folder (as the boot script does).
"$NODE_BIN" /opt/nasa/render-env.cjs "$WORK/ssm.json" "$APP_PORT" > "$WORK/env.new"

changed=$(diff "$WORK/env.new" .env | grep -E '^[<>] [A-Za-z0-9_]+=' | sed -E 's/^[<>] ([A-Za-z0-9_]+)=.*/\1/' | sort -u || true)
other=$(diff "$WORK/env.new" .env | grep -E '^[<>]' | grep -v -E '^[<>] [A-Za-z0-9_]+=' | wc -l || true)
echo "Settings whose line differs from the live .env (names only):"
echo "${changed:-  (none)}"
echo "Other differing lines (parts of multi-line values): $other"

if [ "${1:-}" != "--apply" ]; then
  echo "Dry run: nothing was changed. Run again with --apply to install it and restart."
  exit 0
fi

cp -p .env /opt/nasa/.env.before-rotation
install -m 600 -o ec2-user -g ec2-user "$WORK/env.new" .env
systemctl restart nasa-backend
for _ in $(seq 1 30); do
  if curl -fsS -m 3 "http://127.0.0.1:${APP_PORT}/healthz" > /dev/null 2>&1; then
    echo "healthz ok after the restart. Delete /opt/nasa/.env.before-rotation when the checks are done."
    exit 0
  fi
  sleep 2
done
echo "HEALTHZ FAILED after the restart. Undo with:"
echo "  install -m 600 -o ec2-user -g ec2-user /opt/nasa/.env.before-rotation $APP/.env && systemctl restart nasa-backend"
exit 1

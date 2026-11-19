#!/usr/bin/env bash
# Packages the Backend folder (without node_modules or .env) and uploads it as the release the instances install at boot.
# Usage: infra/scripts/package-backend.sh <artifact-bucket> [git-ref, default HEAD]
set -euo pipefail
BUCKET="${1:?artifact bucket name (terraform output artifact_bucket)}"
REF="${2:-HEAD}"
cd "$(git rev-parse --show-toplevel)"
SHA="$(git rev-parse --short "$REF")"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git archive "$REF" Backend | tar -x -C "$TMP"
rm -f "$TMP/Backend/.env"
tar -czf "$TMP/backend.tgz" -C "$TMP" Backend
aws s3 cp "$TMP/backend.tgz" "s3://$BUCKET/releases/backend-$SHA.tgz"
aws s3 cp "$TMP/backend.tgz" "s3://$BUCKET/releases/backend-latest.tgz"
echo "Uploaded release $SHA. New instances install backend-latest.tgz; to roll it out: aws autoscaling start-instance-refresh --auto-scaling-group-name <asg>"

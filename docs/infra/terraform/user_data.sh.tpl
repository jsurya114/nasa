#!/bin/bash
# Instance bootstrap for the NASA backend. NOT boot-tested: run it once on a throwaway instance before relying on it.
# Log: /var/log/nasa-bootstrap.log
set -euo pipefail
exec > >(tee -a /var/log/nasa-bootstrap.log) 2>&1

REGION="${region}"
BUCKET="${artifact_bucket}"
SSM_PATH="${ssm_path}"
APP_PORT="${app_port}"
DIRECT="${direct}"
DOMAIN="${api_domain}"

TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
INSTANCE_ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)

dnf install -y nodejs${node_major} jq tar gzip
# bcrypt and other modules may compile on first install
dnf install -y gcc-c++ make python3

# 1. Stable public address (direct mode only)
if [ "$DIRECT" = "true" ]; then
  aws ec2 associate-address --region "$REGION" --instance-id "$INSTANCE_ID" --allocation-id "${eip_allocation_id}" --allow-reassociation
fi

# 2. Backend code from the release bucket
mkdir -p /opt/nasa && cd /opt/nasa
aws s3 cp "s3://$BUCKET/releases/backend-latest.tgz" /tmp/backend.tgz
rm -rf /opt/nasa/Backend && tar -xzf /tmp/backend.tgz -C /opt/nasa
cd /opt/nasa/Backend && npm ci --omit=dev

# 3. Settings: defaults first, then every parameter under the SSM path (SSM wins). No secret is written anywhere else.
umask 077
{
  echo "NODE_ENV=production"
  echo "PORT=$APP_PORT"
  echo "TRUST_PROXY=1"
  aws ssm get-parameters-by-path --region "$REGION" --path "$SSM_PATH" --with-decryption --recursive --output json \
    | jq -r '.Parameters[] | ((.Name | split("/") | last) + "=" + (.Value | @json))'
} > /opt/nasa/Backend/.env
chown -R ec2-user:ec2-user /opt/nasa

# 4. Service
cat > /etc/systemd/system/nasa-backend.service <<UNIT
[Unit]
Description=NASA backend
After=network-online.target
Wants=network-online.target

[Service]
User=ec2-user
WorkingDirectory=/opt/nasa/Backend
ExecStart=/usr/bin/node app.js
Restart=always
RestartSec=3
LimitNOFILE=65535
Environment=NODE_OPTIONS=--max-old-space-size=${node_heap_mb}

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now nasa-backend

# 5. Direct mode: Caddy terminates HTTPS (automatic Let's Encrypt) and proxies to the backend. It keeps retrying the
#    certificate until the DNS name points at this instance's Elastic IP, so it can be started before the DNS switch.
if [ "$DIRECT" = "true" ]; then
  ARCH=$(uname -m); [ "$ARCH" = "aarch64" ] && CADDY_ARCH=arm64 || CADDY_ARCH=amd64
  curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${caddy_version}/caddy_${caddy_version}_linux_$CADDY_ARCH.tar.gz" -o /tmp/caddy.tgz
  tar -xzf /tmp/caddy.tgz -C /usr/local/bin caddy && chmod +x /usr/local/bin/caddy
  setcap cap_net_bind_service=+ep /usr/local/bin/caddy
  useradd --system --home /var/lib/caddy --create-home --shell /sbin/nologin caddy || true
  mkdir -p /etc/caddy
  cat > /etc/caddy/Caddyfile <<CADDY
{
  email ${acme_email}
}
$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:$APP_PORT
}
CADDY
  cat > /etc/systemd/system/caddy.service <<UNIT
[Unit]
Description=Caddy
After=network-online.target nasa-backend.service

[Service]
User=caddy
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile
Restart=always
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now caddy
fi
echo "bootstrap finished"

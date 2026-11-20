#!/bin/bash
# Instance bootstrap for the NASA backend. Log: /var/log/nasa-bootstrap.log
# Order matters: install, configure, start, wait until GET /healthz answers, and only then take the Elastic IP, so
# traffic never moves to an instance whose backend is not up.
set -euo pipefail
exec > >(tee -a /var/log/nasa-bootstrap.log) 2>&1

REGION="${region}"
BUCKET="${artifact_bucket}"
SSM_PATH="${ssm_path}"
APP_PORT="${app_port}"
DIRECT="${direct}"
DOMAIN="${api_domain}"
NODE_MAJOR="${node_major}"

TOKEN=$(curl -sf -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
INSTANCE_ID=$(curl -sf -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)

# 1. Node and npm, explicitly (Amazon Linux ships npm as its own package), then prove both run.
dnf install -y nodejs${node_major} nodejs${node_major}-npm jq tar gzip
command -v node >/dev/null || ln -sf "/usr/bin/node-$NODE_MAJOR" /usr/local/bin/node
command -v npm >/dev/null || ln -sf "/usr/bin/npm-$NODE_MAJOR" /usr/local/bin/npm
NODE_BIN=$(command -v node)
node --version | grep -q "^v$NODE_MAJOR\." || { echo "FATAL: node $NODE_MAJOR not installed"; exit 1; }
npm --version >/dev/null || { echo "FATAL: npm missing"; exit 1; }
# bcrypt ships prebuilt binaries for arm64 and x86_64; the compiler is only a fallback
dnf install -y gcc-c++ make python3

%{ if swap_mb > 0 ~}
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=${swap_mb} && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap defaults 0 0' >> /etc/fstab
fi
%{ endif ~}

%{ if local_redis == "true" ~}
# Staging only: a private Redis on 127.0.0.1, so staging never talks to the production Redis.
if dnf install -y valkey; then REDIS_SVC=valkey; REDIS_CONF=/etc/valkey/valkey.conf; else dnf install -y redis6; REDIS_SVC=redis6; REDIS_CONF=/etc/redis6/redis6.conf; fi
printf '\nbind 127.0.0.1 -::1\nprotected-mode yes\nmaxmemory 32mb\nmaxmemory-policy allkeys-lru\nsave ""\nappendonly no\n' >> "$REDIS_CONF"
systemctl enable --now "$REDIS_SVC"
%{ endif ~}

# 2. Backend code from the release bucket
mkdir -p /opt/nasa && cd /opt/nasa
aws s3 cp "s3://$BUCKET/releases/backend-latest.tgz" /tmp/backend.tgz
rm -rf /opt/nasa/Backend && tar -xzf /tmp/backend.tgz -C /opt/nasa
cd /opt/nasa/Backend && npm ci --omit=dev

# 3. Settings. No secret is written anywhere but this 0600 file.
umask 077
ENV_FILE=/opt/nasa/Backend/.env
%{ if environment == "prod" ~}
{
    echo "NODE_ENV=production"
    echo "PORT=$APP_PORT"
    echo "TRUST_PROXY=1"
    aws ssm get-parameters-by-path --region "$REGION" --path "$SSM_PATH" --with-decryption --recursive --output json \
      | jq -r '.Parameters[] | ((.Name | split("/") | last) + "=" + (.Value | @json))'
} > "$ENV_FILE"
%{ else ~}
  # Staging: an ALLOW-LIST. Everee, QuickBooks, push, Cloudinary, the AI connector and every other integration
  # setting are absent, so each one stays switched off (they all need an explicit "true" and credentials).
  DB_PASSWORD=$(aws secretsmanager get-secret-value --region "$REGION" --secret-id "${test_db_secret}" --query SecretString --output text | jq -r .password)
  {
    echo "NODE_ENV=production"
    echo "PORT=$APP_PORT"
    echo "TRUST_PROXY=1"
    echo "NASA_ENVIRONMENT=staging"
    echo "STAGING_GLOBAL_RATE_LIMIT_MAX=${rate_limit_max}"
    echo "FRONTEND_URL=https://staging.invalid"
    echo "LOG_LEVEL=warn"
    echo "DB_HOST=${test_db_host}"
    echo "DB_PORT=${test_db_port}"
    echo "DB_NAME=${test_db_name}"
    echo "DB_USER=${test_db_user}"
    echo "DB_PASSWORD=$(jq -rn --arg v "$DB_PASSWORD" '$v|@json')"
    echo "DB_SSL=true"
    echo "REDIS_HOST=127.0.0.1"
    echo "REDIS_PORT=6379"
    echo "JWT_SECRET=$(openssl rand -hex 48)"
    echo "REFRESH_TOKEN_SECRET=$(openssl rand -hex 48)"
  } > "$ENV_FILE"
  # Insights reads through a separate read-only reporting login (as in production), never the application login.
  # TLS is verified against the official RDS certificate bundle for the region.
  curl -fsSL "https://truststore.pki.rds.amazonaws.com/$REGION/$REGION-bundle.pem" -o /opt/nasa/rds-ca.pem
  REPORTING_PASSWORD=$(openssl rand -hex 24)
  {
    echo "REPORTING_DB_HOST=${test_db_host}"
    echo "REPORTING_DB_PORT=${test_db_port}"
    echo "REPORTING_DB_NAME=${test_db_name}"
    echo "REPORTING_DB_USER=nasa_staging_reporting"
    echo "REPORTING_DB_PASSWORD=$REPORTING_PASSWORD"
    echo "REPORTING_DB_SSL=true"
    echo "REPORTING_DB_SSL_CA=$(jq -Rs . < /opt/nasa/rds-ca.pem)"
  } >> "$ENV_FILE"
  dnf install -y postgresql17 || dnf install -y postgresql16
  PGPASSWORD="$DB_PASSWORD" psql "host=${test_db_host} port=${test_db_port} dbname=${test_db_name} user=${test_db_user} sslmode=require" \
    -v ON_ERROR_STOP=1 -v pw="'$REPORTING_PASSWORD'" <<'SQL'
DO $do$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nasa_reporting_reader') THEN CREATE ROLE nasa_reporting_reader NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nasa_staging_reporting') THEN CREATE ROLE nasa_staging_reporting LOGIN; END IF;
END $do$;
ALTER ROLE nasa_staging_reporting PASSWORD :pw;
GRANT nasa_reporting_reader TO nasa_staging_reporting;
SQL
  unset DB_PASSWORD REPORTING_PASSWORD
  # Refuse to start if anything outside the allow-list is present, or the database is not the staging one.
  ALLOWED='^(NODE_ENV|PORT|TRUST_PROXY|NASA_ENVIRONMENT|STAGING_GLOBAL_RATE_LIMIT_MAX|FRONTEND_URL|LOG_LEVEL|DB_HOST|DB_PORT|DB_NAME|DB_USER|DB_PASSWORD|DB_SSL|REDIS_HOST|REDIS_PORT|JWT_SECRET|REFRESH_TOKEN_SECRET|REPORTING_DB_HOST|REPORTING_DB_PORT|REPORTING_DB_NAME|REPORTING_DB_USER|REPORTING_DB_PASSWORD|REPORTING_DB_SSL|REPORTING_DB_SSL_CA)='
  if grep -vE "$ALLOWED" "$ENV_FILE" | grep -q .; then echo "FATAL: staging settings outside the allow-list"; exit 1; fi
  grep -qx "DB_HOST=${test_db_host}" "$ENV_FILE" && [ -n "${test_db_host}" ] || { echo "FATAL: staging must use its own test database"; exit 1; }
%{ endif ~}
chown -R ec2-user:ec2-user /opt/nasa
chmod 600 "$ENV_FILE"
umask 022 # only the settings file is private; Caddy, systemd units and logs need normal permissions

# 4. Service
cat > /etc/systemd/system/nasa-backend.service <<UNIT
[Unit]
Description=NASA backend
After=network-online.target
Wants=network-online.target

[Service]
User=ec2-user
WorkingDirectory=/opt/nasa/Backend
ExecStart=$NODE_BIN app.js
Restart=always
RestartSec=3
LimitNOFILE=65535
Environment=NODE_OPTIONS=--max-old-space-size=${node_heap_mb}

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now nasa-backend

# 5. Wait for the backend before anything is pointed at it.
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$APP_PORT/healthz" | grep -q '"ok"'; then echo "backend healthy after $((i * 3))s"; break; fi
  [ "$i" = 60 ] && { echo "FATAL: backend did not answer /healthz within 180s; the Elastic IP was NOT moved"; journalctl -u nasa-backend -n 50 --no-pager; exit 1; }
  sleep 3
done

# 6. Direct mode: Caddy terminates HTTPS and proxies to the backend, then this instance takes the Elastic IP.
if [ "$DIRECT" = "true" ]; then
  ARCH=$(uname -m); [ "$ARCH" = "aarch64" ] && CADDY_ARCH=arm64 || CADDY_ARCH=amd64
  curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${caddy_version}/caddy_${caddy_version}_linux_$CADDY_ARCH.tar.gz" -o /tmp/caddy.tgz
  tar -xzf /tmp/caddy.tgz -C /usr/local/bin caddy && chmod +x /usr/local/bin/caddy
  useradd --system --home /var/lib/caddy --create-home --shell /sbin/nologin caddy || true
  mkdir -p /etc/caddy
  cat > /etc/caddy/Caddyfile <<CADDY
{
%{ if tls_mode == "acme" ~}
  email ${acme_email}
%{ endif ~}
}
$DOMAIN {
%{ if tls_mode == "internal" ~}
  tls internal
%{ endif ~}
  encode gzip
  reverse_proxy 127.0.0.1:$APP_PORT
}
CADDY
  chmod 644 /etc/caddy/Caddyfile
  cat > /etc/systemd/system/caddy.service <<UNIT
[Unit]
Description=Caddy
After=network-online.target nasa-backend.service

[Service]
User=caddy
Environment=HOME=/var/lib/caddy
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile
Restart=always
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now caddy

  aws ec2 associate-address --region "$REGION" --instance-id "$INSTANCE_ID" --allocation-id "${eip_allocation_id}" --allow-reassociation
fi

%{ if environment == "staging" ~}
# 7. Staging: a resource sampler for the load test (every 15 s): memory, swap, backend memory and CPU, load.
cat > /usr/local/bin/nasa-sampler <<'SAMPLER'
#!/bin/bash
echo "time,mem_available_mb,swap_used_mb,node_rss_mb,node_cpu_pct,load1" >> /var/log/nasa-sampler.csv
while true; do
  PID=$(systemctl show -p MainPID --value nasa-backend)
  read -r RSS CPU < <(ps -o rss=,pcpu= -p "$PID" 2>/dev/null || echo "0 0")
  MEM=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  SWAP=$(awk '/SwapTotal/ {t=$2} /SwapFree/ {f=$2} END {print int((t-f)/1024)}' /proc/meminfo)
  echo "$(date -u +%FT%TZ),$MEM,$SWAP,$((RSS / 1024)),$CPU,$(cut -d' ' -f1 /proc/loadavg)" >> /var/log/nasa-sampler.csv
  sleep 15
done
SAMPLER
chmod +x /usr/local/bin/nasa-sampler
cat > /etc/systemd/system/nasa-sampler.service <<UNIT
[Unit]
Description=NASA load-test resource sampler
[Service]
ExecStart=/usr/local/bin/nasa-sampler
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now nasa-sampler
%{ endif ~}
echo "bootstrap finished"

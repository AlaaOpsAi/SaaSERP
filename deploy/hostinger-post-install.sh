#!/usr/bin/env bash
# Unattended version of steps 3-4 in docs/DEPLOY-HOSTINGER.md, for Hostinger's
# "post-install script" (VPS setup or OS reinstall). It runs once as root; its
# output goes to /post_install.log on the server.
#
# Set DOMAIN and ACME_EMAIL below before uploading it. The secrets in .env are
# generated on the server and never leave it.
set -euxo pipefail

DOMAIN="${DOMAIN:-app.example.com}"
ACME_EMAIL="${ACME_EMAIL:-admin@example.com}"
BRANCH="${BRANCH:-claude/affectionate-sagan-hru2m7}"
REPO="${REPO:-https://github.com/AlaaOpsAi/SaaSERP.git}"

export HOME=/root DEBIAN_FRONTEND=noninteractive
# The first boot runs its own apt jobs; wait for their lock instead of failing.
echo 'DPkg::Lock::Timeout "900";' > /etc/apt/apt.conf.d/99lock-timeout

apt-get update -y
apt-get install -y git openssl

cd /root
[ -d SaaSERP ] || git clone --branch "$BRANCH" "$REPO" SaaSERP
cd SaaSERP

bash deploy/server-setup.sh

for _ in $(seq 60); do docker info >/dev/null 2>&1 && break; sleep 5; done

if [ ! -f .env ]; then
  umask 077
  cat > .env <<EOF
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
DB_OWNER_PASSWORD=$(openssl rand -hex 16)
DB_APP_PASSWORD=$(openssl rand -hex 16)
DB_READONLY_PASSWORD=$(openssl rand -hex 16)
EOF
fi

echo 'alias dc="docker compose -f docker-compose.yml -f docker-compose.prod.yml"' >> /root/.bashrc
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

echo "SaaSERP is starting on https://$DOMAIN"

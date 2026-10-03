#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu VPS (e.g. Hostinger "Ubuntu 24.04 with Docker").
# Run as root:  bash deploy/server-setup.sh
set -euo pipefail

# Docker (skipped when the VPS template already has it)
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

# Firewall: SSH and web only. The database and app ports stay private.
apt-get update -y && apt-get install -y ufw unattended-upgrades
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# Security updates install themselves.
dpkg-reconfigure -f noninteractive unattended-upgrades

# 2 GB swap so the image build doesn't run out of memory on small plans.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "Server ready. Next: clone SaaSERP, create .env and start it (docs/DEPLOY-HOSTINGER.md)."

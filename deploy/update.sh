#!/usr/bin/env bash
# Cập nhật lên code mới nhất:  sudo bash deploy/update.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
APP_USER="${SUDO_USER:-root}"
cp data/db.json "data/db.backup-$(date +%Y%m%d-%H%M).json" 2>/dev/null || true
sudo -u "$APP_USER" git pull --ff-only
sudo -u "$APP_USER" npm ci --omit=dev
systemctl restart agentappai
echo "✅ Đã cập nhật. Log: sudo journalctl -u agentappai -f"

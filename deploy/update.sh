#!/usr/bin/env bash
# Cập nhật lên code mới nhất:  sudo bash deploy/update.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
APP_USER="${SUDO_USER:-root}"
NODE_BIN="$(cat deploy/.node-bin 2>/dev/null || dirname "$(command -v node)")"
cp data/db.json "data/db.backup-$(date +%Y%m%d-%H%M).json" 2>/dev/null || true
sudo -u "$APP_USER" git pull --ff-only
sudo -u "$APP_USER" env PATH="$NODE_BIN:$PATH" npm ci --omit=dev
systemctl restart agentappai
echo "✅ Đã cập nhật. Log: sudo journalctl -u agentappai -f"

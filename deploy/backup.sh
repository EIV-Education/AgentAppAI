#!/usr/bin/env bash
# Sao lưu dữ liệu, giữ 14 bản gần nhất. Chạy hằng ngày bằng cron:
#   (crontab -l; echo "0 2 * * * bash $(pwd)/deploy/backup.sh") | crontab -
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p backups
cp data/db.json "backups/db-$(date +%Y%m%d-%H%M).json"
ls -1t backups/db-*.json | tail -n +15 | xargs -r rm --

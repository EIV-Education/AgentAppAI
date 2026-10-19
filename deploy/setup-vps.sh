#!/usr/bin/env bash
# Cài trợ lý bán hàng lên VPS Ubuntu 22.04/24.04: Node.js, systemd, nginx, HTTPS (Let's Encrypt).
# Chạy trong thư mục mã nguồn:  sudo bash deploy/setup-vps.sh ten-mien.com email@cua-ban.com
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
SERVICE=agentappai
PORT=3000

if [[ $EUID -ne 0 ]]; then echo "❌ Hãy chạy bằng sudo: sudo bash deploy/setup-vps.sh $*"; exit 1; fi
if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Cách dùng: sudo bash deploy/setup-vps.sh <ten-mien> <email>"
  echo "Ví dụ:     sudo bash deploy/setup-vps.sh shopai.eiv.edu.vn admin@eiv.edu.vn"
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="${SUDO_USER:-root}"
cd "$APP_DIR"
echo "▶ Thư mục: $APP_DIR · chạy dưới user: $APP_USER · tên miền: $DOMAIN"

# 1. Kiểm tra tên miền đã trỏ về VPS chưa (cần cho HTTPS)
SERVER_IP="$(curl -fsS4 https://api.ipify.org || true)"
DOMAIN_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
if [[ -n "$SERVER_IP" && "$SERVER_IP" != "$DOMAIN_IP" ]]; then
  echo "⚠️  $DOMAIN đang trỏ về '${DOMAIN_IP:-không có}', còn IP VPS là $SERVER_IP."
  echo "   Hãy tạo bản ghi A: $DOMAIN -> $SERVER_IP, đợi vài phút rồi chạy lại."
  exit 1
fi

# 2. Gói hệ thống
apt-get update -y
apt-get install -y ca-certificates curl git nginx certbot python3-certbot-nginx

NODE_MAJOR="$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/' || echo 0)"
if [[ "${NODE_MAJOR:-0}" -lt 20 ]]; then
  echo "▶ Cài Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "▶ Node $(node -v)"

# 3. Thư viện
chown -R "$APP_USER" "$APP_DIR"
sudo -u "$APP_USER" npm ci --omit=dev

# 4. File cấu hình .env
if [[ ! -f .env ]]; then
  cp .env.example .env
  TOKEN="$(openssl rand -hex 16)"
  sed -i "s|^ADMIN_TOKEN=.*|ADMIN_TOKEN=$TOKEN|" .env
  echo "▶ Đã tạo .env với ADMIN_TOKEN=$TOKEN (ghi lại để đăng nhập dashboard)"
fi
set_env() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
set_env PUBLIC_URL "https://$DOMAIN"
set_env PORT "$PORT"
set_env HOST 127.0.0.1
set_env DATA_FILE "$APP_DIR/data/db.json"
mkdir -p data
chown -R "$APP_USER" .env data
chmod 600 .env

# 5. Dịch vụ systemd (tự chạy lại khi lỗi hoặc khởi động lại VPS)
cat > /etc/systemd/system/$SERVICE.service <<UNIT
[Unit]
Description=Tro ly ban hang AI da kenh
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) src/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now $SERVICE
systemctl restart $SERVICE

# 6. nginx làm cổng HTTPS phía trước
cat > /etc/nginx/sites-available/$SERVICE <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # Dashboard cập nhật trực tiếp (SSE): không đệm, giữ kết nối lâu
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/$SERVICE /etc/nginx/sites-enabled/$SERVICE
nginx -t
systemctl reload nginx

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full'
fi

# 7. Chứng chỉ HTTPS miễn phí, tự gia hạn
certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos -n --redirect

sleep 2
if curl -fsS "https://$DOMAIN/healthz" >/dev/null; then
  echo ""
  echo "✅ Xong! Dashboard: https://$DOMAIN"
else
  echo "⚠️  Chưa truy cập được https://$DOMAIN/healthz — xem log: sudo journalctl -u $SERVICE -n 50"
fi
echo ""
echo "Việc tiếp theo:"
echo "  1. Điền ANTHROPIC_API_KEY và các khoá kênh:  nano $APP_DIR/.env"
echo "  2. Khởi động lại sau mỗi lần sửa .env:       sudo systemctl restart $SERVICE"
echo "  3. Xem log:                                  sudo journalctl -u $SERVICE -f"

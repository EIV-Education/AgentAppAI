#!/usr/bin/env bash
# Cài trợ lý bán hàng lên VPS Ubuntu/Debian — an toàn cả khi VPS đang chạy website khác:
#  - Không nâng cấp Node.js của hệ thống: nếu Node < 20, tải Node 22 riêng vào .runtime/ chỉ cho trợ lý dùng
#  - Tự chọn cổng trống, chỉ nghe trên 127.0.0.1
#  - Có control panel (aaPanel, cPanel, DirectAdmin, CyberPanel, HestiaCP, Plesk) hoặc Apache/LiteSpeed:
#    KHÔNG đụng web server, chỉ in hướng dẫn tạo reverse proxy trong panel
#  - Có sẵn nginx: chỉ thêm 1 file cấu hình riêng cho tên miền phụ, lỗi thì tự gỡ ra
#
# Chạy trong thư mục mã nguồn:  sudo bash deploy/setup-vps.sh <ten-mien-phu> <email>
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
SERVICE=agentappai

if [[ $EUID -ne 0 ]]; then echo "❌ Hãy chạy bằng sudo: sudo bash deploy/setup-vps.sh $*"; exit 1; fi
if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Cách dùng: sudo bash deploy/setup-vps.sh <ten-mien-phu> <email>"
  echo "Ví dụ:     sudo bash deploy/setup-vps.sh ai.eiv.edu.vn admin@eiv.edu.vn"
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="${SUDO_USER:-root}"
cd "$APP_DIR"
echo "▶ Thư mục: $APP_DIR · user: $APP_USER · tên miền: $DOMAIN"

# ---------- 1. Kiểm tra trước, chưa thay đổi gì ----------
if ! command -v ss >/dev/null || ! command -v curl >/dev/null; then
  apt-get update -y && apt-get install -y iproute2 curl
fi
SERVER_IP="$(curl -fsS4 --max-time 10 https://api.ipify.org || true)"
DOMAIN_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
if [[ -n "$SERVER_IP" && "$SERVER_IP" != "$DOMAIN_IP" ]]; then
  echo "❌ $DOMAIN đang trỏ về '${DOMAIN_IP:-không có}', còn IP VPS là $SERVER_IP."
  echo "   Tạo bản ghi A: $DOMAIN -> $SERVER_IP, đợi vài phút rồi chạy lại."
  echo "   (Nếu dùng Cloudflare: tạm tắt đám mây cam — chế độ DNS only — khi cài.)"
  exit 1
fi

PANEL=""
[[ -d /www/server/panel ]] && PANEL="aaPanel"
[[ -d /usr/local/cpanel ]] && PANEL="cPanel"
[[ -d /usr/local/directadmin ]] && PANEL="DirectAdmin"
[[ -d /usr/local/CyberCP ]] && PANEL="CyberPanel"
[[ -d /usr/local/hestia ]] && PANEL="HestiaCP"
[[ -d /usr/local/psa ]] && PANEL="Plesk"

WEB80="$(ss -ltnpH 'sport = :80' 2>/dev/null | grep -oE '"[a-zA-Z0-9_.-]+"' | head -1 | tr -d '"' || true)"
MODE="nginx-new"
if [[ -n "$PANEL" ]]; then MODE="panel"
elif [[ -n "$WEB80" && "$WEB80" != "nginx" ]]; then MODE="other-web"
elif [[ "$WEB80" == "nginx" ]]; then MODE="nginx-existing"
fi
echo "▶ Web server hiện tại: ${PANEL:-${WEB80:-chưa có}} → chế độ cài: $MODE"

if [[ "$MODE" == "nginx-existing" ]] && grep -rqsw --exclude="$SERVICE" "server_name.*$DOMAIN" /etc/nginx/; then
  echo "❌ $DOMAIN đã được một website khác dùng trong nginx. Hãy chọn tên miền phụ khác (vd ai.$DOMAIN)."
  exit 1
fi

# Chọn cổng trống (giữ cổng cũ nếu đã cài trước đó)
PORT="$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || true)"
if [[ -z "$PORT" ]] || { ss -ltnH "sport = :$PORT" | grep -q . && ! systemctl is-active -q $SERVICE; }; then
  for p in $(seq 3100 3199); do
    if ! ss -ltnH "sport = :$p" | grep -q .; then PORT=$p; break; fi
  done
fi
echo "▶ Trợ lý sẽ chạy ở cổng nội bộ 127.0.0.1:$PORT"

# ---------- 2. Node.js riêng, không đụng Node của website ----------
apt-get update -y
apt-get install -y ca-certificates curl git xz-utils

NODE_BIN=""
if command -v node >/dev/null; then
  SYS_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
  [[ "$SYS_MAJOR" -ge 20 ]] && NODE_BIN="$(dirname "$(command -v node)")"
fi
if [[ -z "$NODE_BIN" ]]; then
  case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) echo "❌ CPU $(uname -m) chưa hỗ trợ"; exit 1 ;; esac
  BASE=https://nodejs.org/dist/latest-v22.x
  FILE="$(curl -fsS "$BASE/SHASUMS256.txt" | awk -v a="linux-$ARCH.tar.xz" '$2 ~ a"$" {print $2}')"
  SUM="$(curl -fsS "$BASE/SHASUMS256.txt" | awk -v f="$FILE" '$2==f {print $1}')"
  echo "▶ Tải $FILE riêng cho trợ lý (không thay Node của hệ thống)"
  TMP="$(mktemp -d)"
  curl -fsSL "$BASE/$FILE" -o "$TMP/$FILE"
  echo "$SUM  $TMP/$FILE" | sha256sum -c -
  rm -rf .runtime/node && mkdir -p .runtime/node
  tar -xJf "$TMP/$FILE" -C .runtime/node --strip-components=1
  rm -rf "$TMP"
  NODE_BIN="$APP_DIR/.runtime/node/bin"
fi
echo "$NODE_BIN" > deploy/.node-bin
echo "▶ Node dùng cho trợ lý: $("$NODE_BIN/node" -v) ($NODE_BIN)"

chown -R "$APP_USER" "$APP_DIR"
sudo -u "$APP_USER" env PATH="$NODE_BIN:$PATH" npm ci --omit=dev

# ---------- 3. Cấu hình .env ----------
if [[ ! -f .env ]]; then
  cp .env.example .env
  TOKEN="$(openssl rand -hex 16)"
  sed -i "s|^ADMIN_TOKEN=.*|ADMIN_TOKEN=$TOKEN|" .env
  echo "▶ Đã tạo .env với ADMIN_TOKEN=$TOKEN  ← GHI LẠI để đăng nhập dashboard"
fi
set_env() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
set_env PUBLIC_URL "https://$DOMAIN"
set_env PORT "$PORT"
set_env HOST 127.0.0.1
set_env DATA_FILE "$APP_DIR/data/db.json"
mkdir -p data
chown -R "$APP_USER" .env data
chmod 600 .env

# ---------- 4. Dịch vụ systemd ----------
cat > /etc/systemd/system/$SERVICE.service <<UNIT
[Unit]
Description=Tro ly ban hang AI da kenh
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN/node src/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
MemoryMax=512M

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable $SERVICE >/dev/null
systemctl restart $SERVICE
sleep 2
if ! curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null; then
  echo "❌ Trợ lý chưa chạy được. Xem lỗi: sudo journalctl -u $SERVICE -n 50"
  exit 1
fi
echo "✅ Trợ lý đang chạy ở 127.0.0.1:$PORT"

# ---------- 5. Cổng HTTPS ----------
print_manual() {
  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo " Bước cuối làm tay ($1) — để không ảnh hưởng website đang chạy:"
  echo "════════════════════════════════════════════════════════════"
  echo " 1. Tạo website mới cho tên miền: $DOMAIN"
  echo " 2. Bật SSL (Let's Encrypt) cho $DOMAIN"
  echo " 3. Bật Reverse Proxy cho $DOMAIN trỏ tới: http://127.0.0.1:$PORT"
  case "$1" in
    aaPanel)  echo "    aaPanel: Website → Add site → vào site → Reverse proxy → Add → Target URL http://127.0.0.1:$PORT" ;;
    CyberPanel|OpenLiteSpeed|litespeed|lshttpd) echo "    LiteSpeed: tạo External App (Web Server) 127.0.0.1:$PORT + Context 'Proxy' cho URI /" ;;
    apache2|httpd) echo "    Apache: a2enmod proxy proxy_http; trong VirtualHost của $DOMAIN thêm:"
                   echo "      ProxyPreserveHost On"
                   echo "      ProxyPass / http://127.0.0.1:$PORT/ flushpackets=on"
                   echo "      ProxyPassReverse / http://127.0.0.1:$PORT/" ;;
    *) echo "    Trong panel tìm mục 'Reverse Proxy' / 'Proxy' của website $DOMAIN" ;;
  esac
  echo " 4. Kiểm tra: mở https://$DOMAIN/healthz thấy {\"ok\":true} là xong"
  echo "════════════════════════════════════════════════════════════"
}

if [[ "$MODE" == "panel" ]]; then print_manual "$PANEL"
elif [[ "$MODE" == "other-web" ]]; then print_manual "$WEB80"
else
  [[ "$MODE" == "nginx-new" ]] && apt-get install -y nginx
  apt-get install -y certbot python3-certbot-nginx
  CONF=/etc/nginx/sites-available/$SERVICE
  cat > "$CONF" <<NGINX
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
  ln -sf "$CONF" /etc/nginx/sites-enabled/$SERVICE
  if ! nginx -t; then
    echo "❌ Cấu hình nginx lỗi — đã gỡ file vừa thêm, website cũ không bị ảnh hưởng."
    rm -f /etc/nginx/sites-enabled/$SERVICE "$CONF"
    exit 1
  fi
  systemctl reload nginx
  if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 'Nginx Full'; fi
  # Chỉ xin chứng chỉ cho tên miền phụ của trợ lý; không đụng chứng chỉ của website khác
  certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos -n --redirect
  sleep 2
  if curl -fsS "https://$DOMAIN/healthz" >/dev/null; then echo "✅ Xong! Dashboard: https://$DOMAIN"
  else echo "⚠️  Chưa mở được https://$DOMAIN — xem: sudo journalctl -u $SERVICE -n 50 và sudo nginx -t"; fi
fi

echo ""
echo "Việc tiếp theo:"
echo "  1. Điền ANTHROPIC_API_KEY và khoá các kênh:  nano $APP_DIR/.env"
echo "  2. Khởi động lại sau mỗi lần sửa .env:       sudo systemctl restart $SERVICE"
echo "  3. Xem log:                                  sudo journalctl -u $SERVICE -f"

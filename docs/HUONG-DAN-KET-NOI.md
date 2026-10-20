# Hướng dẫn kết nối và chạy thật

Trợ lý chạy thật cần **một server có địa chỉ HTTPS chạy 24/7**. Sau đó lần lượt nối **Lark → Zalo OA → Facebook → website**. Lark nối nhanh nhất (khoảng 15 phút). Facebook lâu nhất vì muốn trả lời khách thật thì Meta phải duyệt app.

> Ghi chú: Tên menu trên trang quản trị của Zalo, Meta và Lark hay thay đổi. Nếu không thấy đúng tên ghi dưới đây, hãy tìm mục có ý nghĩa tương tự. Em viết các bước này theo tài liệu của từng nền tảng nhưng **chưa thử trên tài khoản thật**.

---

## Bước 1: Đưa server lên Railway (khoảng 15 phút)

Railway tự cấp HTTPS và có ổ đĩa để lưu dữ liệu. Không cần biết quản trị máy chủ. ⚠️ Gói trả phí của Railway khoảng **5 USD/tháng**; hãy kiểm tra giá hiện tại tại railway.com/pricing.

1. Vào **railway.com** → *Login with GitHub* (dùng tài khoản có quyền vào repo `EIV-Education/AgentAppAI`).
2. *New Project* → *Deploy from GitHub repo* → chọn **AgentAppAI**.
3. Bấm vào service vừa tạo → *Settings* → *Source* → *Branch*: chọn `claude/keen-knuth-q76pj6` (hoặc `main` nếu anh đã gộp code vào main).
4. **Gắn ổ đĩa lưu dữ liệu**: chuột phải vào service → *Attach Volume* → Mount path: `/data`.
   *Thiếu bước này thì mỗi lần cập nhật code, toàn bộ hội thoại, đơn và catalog sẽ mất.*
5. *Settings* → *Networking* → *Generate Domain*. Railway cấp một địa chỉ dạng `https://agentappai-production.up.railway.app`.
6. Mở tab *Variables* và thêm:

   | Tên | Giá trị |
   |---|---|
   | `ANTHROPIC_API_KEY` | Khoá `sk-ant-...` lấy tại console.anthropic.com |
   | `ADMIN_TOKEN` | Mật khẩu dashboard, đặt dài và khó đoán |
   | `PUBLIC_URL` | Địa chỉ ở bước 5 (không có dấu `/` ở cuối) |
   | `DATA_FILE` | `/data/db.json` |

7. Railway tự chạy lại. Mở địa chỉ ở bước 5 và đăng nhập bằng `ADMIN_TOKEN`.
8. Vào **Cài đặt** → khung **"Địa chỉ kết nối các kênh"**. Khung này có sẵn các URL cần dán ở các bước sau, kèm trạng thái ✅ / ⚪ của từng kênh.

Từ đây, **mỗi lần thêm hoặc sửa biến trong *Variables*, Railway tự khởi động lại** (mất khoảng 1 phút). Lỗi xem ở tab *Deployments* → *View logs*.

---

## Bước 1 (cách khác): Chạy trên VPS riêng (khoảng 20 phút)

Dùng cách này nếu anh đã có VPS hoặc muốn đặt server ở Việt Nam (Viettel, VNPT, BizFly, Vietnix…). Bỏ qua cách này nếu đã chọn Railway.

**Cần chuẩn bị:**
- VPS chạy **Ubuntu 22.04 hoặc 24.04**, cấu hình tối thiểu **1 CPU, 1 GB RAM**. Trợ lý gọi Claude qua mạng nên máy không cần mạnh.
- Một **tên miền hoặc tên miền phụ** (ví dụ `shopai.eiv.edu.vn`). Vào trang quản lý DNS, tạo **bản ghi A** trỏ tên miền đó về IP của VPS. Bắt buộc phải có, vì Facebook và Zalo chỉ gửi tin tới địa chỉ HTTPS.
- **VPS đang chạy website khác?** Vẫn dùng được. Chỉ cần đặt trợ lý ở **tên miền phụ riêng** (ví dụ `ai.eiv.edu.vn`), không dùng chung tên miền với website. Script sẽ không đụng tới website đang chạy:
  - Giữ nguyên Node.js của hệ thống. Nếu bản có sẵn cũ hơn 20, script tải Node riêng chỉ cho trợ lý dùng.
  - Tự chọn một cổng nội bộ còn trống (từ 3100 trở lên).
  - Nếu máy dùng **control panel** (aaPanel, cPanel, DirectAdmin, CyberPanel, HestiaCP, Plesk) hoặc **Apache/LiteSpeed**: script không sửa web server, chỉ in hướng dẫn bật *Reverse Proxy* trong panel (khoảng 3 phút làm tay).
  - Nếu máy dùng **nginx**: script chỉ thêm một file cấu hình riêng cho tên miền phụ. Cấu hình lỗi thì tự gỡ ra.
  - Nên **sao lưu VPS (snapshot)** trước khi chạy cho chắc.

**Các bước:**
1. Đăng nhập VPS bằng SSH: `ssh root@IP-VPS` (Windows dùng PowerShell hoặc PuTTY).
2. Tải mã nguồn về. Repo là riêng tư nên GitHub sẽ hỏi đăng nhập: nhập tên GitHub và **Personal Access Token** (tạo tại github.com → *Settings* → *Developer settings* → *Personal access tokens*, cấp quyền đọc repo).
   ```bash
   apt-get update && apt-get install -y git
   git clone https://github.com/EIV-Education/AgentAppAI.git /opt/agentappai
   cd /opt/agentappai
   git checkout claude/keen-knuth-q76pj6
   ```
3. Chạy script cài đặt tự động. Thay tên miền và email bằng của anh:
   ```bash
   sudo bash deploy/setup-vps.sh shopai.eiv.edu.vn admin@eiv.edu.vn
   ```
   Script làm toàn bộ những việc sau:
   - Kiểm tra tên miền đã trỏ đúng về VPS chưa.
   - Cài Node.js 22 (nếu máy chưa có bản 20 trở lên) và cổng HTTPS (nginx).
   - Tạo file `.env` kèm **mật khẩu dashboard ngẫu nhiên**. Mật khẩu in ra màn hình, anh **ghi lại**.
   - Cài trợ lý thành dịch vụ tự chạy lại khi lỗi hoặc khi VPS khởi động lại.
   - Lấy chứng chỉ HTTPS miễn phí, tự gia hạn.
4. Điền khoá Claude: `nano /opt/agentappai/.env` → sửa dòng `ANTHROPIC_API_KEY=` → `Ctrl+O`, `Enter`, `Ctrl+X` → khởi động lại:
   ```bash
   sudo systemctl restart agentappai
   ```
5. Mở `https://ten-mien-cua-anh` và đăng nhập bằng mật khẩu ở bước 3.

**VPS dùng aaPanel làm thêm gì?** Script nhận ra aaPanel và không sửa nginx của aaPanel. Cuối script có một khung hướng dẫn kèm **số cổng** (ví dụ `3100`). Anh mở aaPanel trên trình duyệt và làm đúng thứ tự sau:

1. **Website → Add site**
   - Domain: `ai.eiv.edu.vn` (tên miền phụ đã trỏ về VPS)
   - Database: **No** · PHP version: **Static** → *Submit*
2. **Bật HTTPS trước**: bấm vào site vừa tạo → tab **SSL** → **Let's Encrypt** → tick tên miền → *Apply* → bật **Force HTTPS**.
   *Phải làm bước này trước bước 3. Nếu bật Reverse proxy trước, Let's Encrypt sẽ không kiểm tra được tên miền và báo lỗi.*
3. **Trỏ về trợ lý**: cùng cửa sổ đó → tab **Reverse proxy** → *Add reverse proxy*
   - Proxy name: `trolyai`
   - Target URL: `http://127.0.0.1:3100` (lấy đúng số cổng script in ra)
   - Sent Domain: `$host`
   - **Không** bật Cache → *Submit*
4. Mở `https://ai.eiv.edu.vn/healthz`, thấy `{"ok":true}` là xong. Sau đó mở `https://ai.eiv.edu.vn` để vào dashboard.

Website cũ trên aaPanel không bị ảnh hưởng, vì trợ lý là một site riêng với tên miền riêng. ⚠️ Chứng chỉ HTTPS do aaPanel tự gia hạn sau mỗi 3 tháng. Nếu một ngày aaPanel báo gia hạn thất bại, anh tạm tắt Reverse proxy, bấm gia hạn, rồi bật lại.

**Trên VPS, các bước nối kênh phía dưới làm thế nào?** Chỗ nào ghi "thêm biến trong *Variables* của Railway" thì anh làm thay bằng: sửa file `.env` bằng lệnh `nano /opt/agentappai/.env`, rồi chạy `sudo systemctl restart agentappai`. Chỗ nào ghi "xem *View logs*" thì dùng lệnh `sudo journalctl -u agentappai -f`.

**Các lệnh hay dùng:**

| Việc | Lệnh |
|---|---|
| Xem log trực tiếp | `sudo journalctl -u agentappai -f` |
| Khởi động lại | `sudo systemctl restart agentappai` |
| Cập nhật code mới (tự sao lưu dữ liệu trước) | `sudo bash /opt/agentappai/deploy/update.sh` |
| Sao lưu tự động lúc 2 giờ sáng mỗi ngày | `(crontab -l 2>/dev/null; echo "0 2 * * * bash /opt/agentappai/deploy/backup.sh") \| crontab -` |

---

## Bước 2: Nối Lark để điều khiển (khoảng 15 phút)

1. Vào **open.larksuite.com/app** (Feishu thì vào open.feishu.cn và đặt thêm biến `LARK_DOMAIN=https://open.feishu.cn`) → *Create Custom App*.
2. *Credentials & Basic Info*: chép **App ID** → biến `LARK_APP_ID`, **App Secret** → `LARK_APP_SECRET`.
3. *Add Features* → bật **Bot**.
4. *Permissions & Scopes* → thêm 3 quyền:
   - `im:message.p2p_msg:readonly` (đọc tin nhắn riêng gửi cho bot)
   - `im:message.group_at_msg:readonly` (đọc tin @bot trong nhóm)
   - `im:message:send_as_bot` (bot gửi tin)
5. *Events & Callbacks* → *Encryption Strategy*: chép **Verification Token** → biến `LARK_VERIFICATION_TOKEN`. **Không** bật Encrypt Key. Đợi Railway khởi động lại xong.
6. Cùng trang đó → *Event Configuration* → chọn "Send events to developer server" → Request URL: `PUBLIC_URL/webhooks/lark` → Save (Lark kiểm tra địa chỉ, thấy ✅ là được). Sau đó *Add Events* → `im.message.receive_v1`.
7. *Version Management & Release* → *Create a version* → *Publish*. Quản trị viên Lark của công ty phải duyệt bản này.
8. Mở Lark, tìm tên bot, nhắn **`help`**. Bot trả lời *"Chat này chưa được cấp quyền… chat ID: oc_xxx"*. Chép mã `oc_xxx` vào biến `LARK_OWNER_CHAT_IDS`.
9. Railway khởi động lại xong, nhắn **`help`** lần nữa: bot hiện danh sách lệnh là thành công. Từ giờ thông báo đơn mới và câu hỏi cần anh trả lời sẽ về chat này.

---

## Bước 3: Nối Zalo OA (khoảng 30–45 phút)

Cần sẵn: một **Zalo Official Account** đã được duyệt, và tài khoản Zalo cá nhân là quản trị viên của OA đó.

1. Vào **developers.zalo.me** → đăng nhập → *Tạo ứng dụng*.
2. Trong ứng dụng → *Thông tin ứng dụng* (hoặc *Cài đặt*): chép **ID ứng dụng** → `ZALO_APP_ID`, **Khóa bí mật** → `ZALO_APP_SECRET`.
3. *Sản phẩm* → **Official Account** → liên kết ứng dụng với OA của shop.
4. **Xác thực domain** (Zalo bắt buộc trước khi khai báo webhook):
   - Mục *Xác thực domain* → nhập domain Railway (không có `https://`).
   - Chọn cách **thẻ meta**. Zalo đưa ra một thẻ dạng `<meta name="zalo-platform-site-verification" content="ABC123" />`.
   - Chỉ chép phần trong `content` (ví dụ `ABC123`) → biến `ZALO_SITE_VERIFICATION`. Đợi Railway khởi động lại xong rồi bấm **Xác thực**.
5. **Webhook**:
   - URL: `PUBLIC_URL/webhooks/zalo`.
   - Bật các sự kiện *người dùng gửi tin nhắn*: tối thiểu `user_send_text`, nên bật thêm `user_send_image` và `user_send_sticker`.
   - Chép **OA Secret Key** của phần webhook → biến `ZALO_OA_SECRET_KEY`.
6. **Lấy token của OA**: vào **API Explorer** (developers.zalo.me/tools/explorer) → chọn ứng dụng → loại token **OA Access Token** → *Lấy Access Token* → đăng nhập và cho phép.
   - **Access Token** → `ZALO_OA_ACCESS_TOKEN`
   - **Refresh Token** → `ZALO_OA_REFRESH_TOKEN`

   Access token hết hạn sau khoảng 25 giờ; hệ thống **tự làm mới** bằng refresh token. Anh chỉ phải lấy lại bằng tay khi bot báo lỗi token (ví dụ để server tắt quá lâu).
7. **Gán quyền điều khiển cho chủ shop**: dùng Zalo cá nhân → tìm OA → *Quan tâm* → nhắn **`/id`**. OA trả về ID → chép vào `ZALO_OWNER_IDS`. Nhiều người thì cách nhau bằng dấu phẩy.
8. Railway khởi động lại xong:
   - Nhắn OA **`/help`**: OA trả danh sách lệnh là kênh điều khiển đã chạy.
   - Nhắn OA một câu bình thường như *"áo polo giá bao nhiêu"*: trợ lý trả lời như với khách, và hội thoại hiện trong dashboard (kênh Zalo).

**Không thấy hội thoại Zalo trong dashboard?** Mở *View logs* trên Railway:
- Thấy dòng `[zalo] sai chữ ký webhook`: tạm xoá biến `ZALO_OA_SECRET_KEY` để thử lại, rồi gửi em dòng log đó để em chỉnh cách kiểm tra chữ ký.
- Thấy `Zalo gửi lỗi …`: gửi em nguyên dòng lỗi.

> ⚠️ Zalo chỉ cho OA nhắn người đã tương tác với OA trong **7 ngày**. Chủ shop nên gõ `/baocao` cho OA mỗi sáng để luôn nhận được thông báo.

---

## Bước 4: Nối Facebook Messenger (nhiều Trang)

1. **developers.facebook.com** → *My Apps* → *Create App* → use case **"Engage with customers on Messenger from Meta"** (Messenger) → gắn với Business Portfolio của EIV.
2. *App settings → Basic*: chép **App ID** và **App Secret**; điền *Privacy Policy URL* (trang chính sách bảo mật của website). Trong *App Domains* thêm `agentai.eiv.edu.vn`.
3. Thêm sản phẩm **Facebook Login for Business** (hoặc *Facebook Login*) → *Settings* → **Valid OAuth Redirect URIs**: `https://agentai.eiv.edu.vn/webhooks/facebook/oauth` → lưu.
4. *Messenger → Messenger API Settings* → **Configure webhooks**: Callback URL `https://agentai.eiv.edu.vn/webhooks/facebook`, Verify token `eiv-verify` → *Verify and save* → bật các trường **messages**, **messaging_postbacks**.
5. Trên VPS (thay giá trị):
   ```bash
   sed -i 's|^FB_APP_ID=.*|FB_APP_ID=DAN_APP_ID|; s|^FB_APP_SECRET=.*|FB_APP_SECRET=DAN_APP_SECRET|' /opt/agentappai/.env && sudo systemctl restart agentappai
   ```
   (File `.env` cũ chưa có dòng `FB_APP_ID=` thì thêm: `echo "FB_APP_ID=DAN_APP_ID" >> /opt/agentappai/.env`.)
6. Dashboard → **Cài đặt** → **Trang Facebook** → **🔗 Kết nối Facebook** → đăng nhập tài khoản quản trị Trang → **chọn các Trang** muốn cấp quyền → cho phép đủ quyền.
7. Quay lại dashboard → tick **bật trợ lý** cho từng Trang muốn trực (Trang không liên quan như "Bếp Ăn Thiện Nguyện" để tắt).
8. **Mở cho khách thật**: khi app còn ở chế độ phát triển, chỉ người có vai trò trong app nhắn được. Cần *App Review* các quyền **pages_messaging**, **pages_manage_metadata**, **pages_show_list**, **pages_read_engagement** (Advanced Access) + **xác minh doanh nghiệp**, rồi chuyển app sang **Live**. ⚠️ Thời gian duyệt tuỳ Meta.

## Bước 5: Gắn chat vào website (khoảng 2 phút)

Dán dòng sau vào trước thẻ `</body>` của website (WordPress: dùng plugin *Insert Headers and Footers*; Haravan/Sapo: mục chỉnh sửa giao diện → `theme.liquid`):

```html
<script src="https://PUBLIC_URL/widget.js" defer></script>
```

---

## Bước 6: Nạp dữ liệu thật trước khi mở cho khách

1. **Cài đặt**: tên shop, hotline, giờ làm việc, **chính sách giao hàng, đổi trả, thanh toán**, bảng phí ship. Trợ lý chỉ trả lời theo đúng những gì anh điền ở đây.
2. **Catalog**: xoá 6 sản phẩm mẫu, rồi *Nhập CSV* catalog thật. Mẫu cột nằm trong `README.md`.
3. **Kiến thức**: thêm 10–20 câu khách hay hỏi kèm câu trả lời chuẩn (chọn size, chất liệu, cách bảo quản…).
4. Tự đóng vai khách để chat thử khoảng 10 câu. Câu nào chưa ổn thì bấm **🎓 Dạy**.

## Kiểm tra cuối: biết đã chạy đủ chưa thế nào?

- [ ] Dashboard → Cài đặt: Claude AI, Facebook, Zalo, Lark đều **✅**
- [ ] Nhắn Fanpage, OA và web chat: cả 3 hội thoại hiện trên dashboard, trợ lý trả lời đúng giá
- [ ] Hỏi một câu shop chưa có dữ liệu: Lark/Zalo của chủ shop nhận thông báo "cần bạn hỗ trợ"
- [ ] Chốt thử một đơn: nhận thông báo đơn nháp, gõ `/duyet D1`, khách nhận tin xác nhận
- [ ] Gõ `/tamdung`: trợ lý ngừng trả lời. Gõ `/tieptuc`: trợ lý trả lời lại

---

## Nối CRM Lark Base (tự đẩy khách tiềm năng lên CRM)

Mỗi khách tiềm năng (trợ lý thu thập trong chat, hoặc nhân viên bấm **+ Thêm khách** sau khi tư vấn) tự tạo một dòng trong bảng CRM: tên, SĐT, nhu cầu, địa chỉ... Khi khách bổ sung thông tin hoặc nhân viên sửa, dòng đó được cập nhật.

1. **Tạo ứng dụng Lark** (bỏ qua nếu đã có ứng dụng cho bot điều khiển): open.larksuite.com/app → *Create Custom App* → chép **App ID**, **App Secret**.
2. **Cấp quyền Base**: *Permissions & Scopes* → thêm quyền **`bitable:app`** (xem, chỉnh sửa Base) → *Version Management & Release* → tạo phiên bản → *Publish* (quản trị Lark duyệt).
3. **Thêm ứng dụng vào bảng CRM**: mở Base CRM → nút **…** góc phải trên → **Thêm ứng dụng tài liệu** (*Add document app*) → chọn ứng dụng vừa tạo → quyền **Có thể chỉnh sửa**.
4. **Điền vào VPS** (Phần cuối):
   ```bash
   sed -i 's|^LARK_APP_ID=.*|LARK_APP_ID=DAN_APP_ID|; s|^LARK_APP_SECRET=.*|LARK_APP_SECRET=DAN_APP_SECRET|' /opt/agentappai/.env && sudo systemctl restart agentappai
   ```
5. **Dashboard → Cài đặt → CRM Lark Base**: dán link bảng CRM → **Tải cột từ CRM** → kiểm tra cột được ghép (đã đoán sẵn theo tên) → tick **Bật tự động đẩy khách lên CRM** → **Lưu CRM**.
6. Thử: tab **Khách tiềm năng** → **+ Thêm khách** → mở bảng CRM thấy dòng mới là xong. Thẻ khách hiện **✅ Đã lên CRM**; nếu lỗi sẽ hiện lý do và nút **Gửi lại** (hệ thống cũng tự gửi lại mỗi 10 phút).

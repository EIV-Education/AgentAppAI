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

## Bước 4: Nối Facebook Messenger (khoảng 30 phút cài đặt, cộng thời gian Meta duyệt)

1. Vào **developers.facebook.com** → *My Apps* → *Create App* → chọn use case **"Engage with customers on Messenger from Meta"** → gắn với Business Portfolio (Business Manager) của shop.
2. *App settings* → *Basic*: chép **App Secret** → biến `FB_APP_SECRET`. Điền thêm *Privacy Policy URL* (trang chính sách bảo mật của website shop).
3. *Messenger* → *Messenger API Settings*:
   - **Generate access tokens** → *Connect* Fanpage → *Generate* → chép token → biến `FB_PAGE_ACCESS_TOKEN`. Đợi Railway khởi động lại xong.
   - **Configure webhooks**: Callback URL `PUBLIC_URL/webhooks/facebook`, Verify token = `eiv-verify` (hoặc giá trị anh đặt trong `FB_VERIFY_TOKEN`) → *Verify and save*.
   - Ở dòng Fanpage → *Add subscriptions* → tick **`messages`** và **`messaging_postbacks`**.
4. **Thử ngay**: dùng chính tài khoản Facebook quản trị app, nhắn tin cho Fanpage. Trợ lý sẽ trả lời và hội thoại hiện trong dashboard (kênh FB).
5. **Mở cho mọi khách**: lúc này app đang ở chế độ phát triển, chỉ người có vai trò trong app mới chat được. Muốn khách thật dùng:
   - *App Review* → xin quyền **`pages_messaging`** (Advanced Access). Meta yêu cầu video quay màn hình demo trợ lý trả lời tin nhắn.
   - Hoàn tất **xác minh doanh nghiệp** (Business Verification) nếu Meta yêu cầu.
   - Duyệt xong → chuyển app sang **Live**. ⚠️ Thời gian duyệt tuỳ Meta, thường vài ngày.

---

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

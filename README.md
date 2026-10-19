# Trợ lý bán hàng AI đa kênh

Nhân viên bán hàng AI trực **Facebook Messenger, Zalo OA và chat trên website**. Mọi hội thoại về chung một dashboard. Trợ lý tư vấn và báo giá đúng theo catalog của shop, trả lời câu hỏi về ship và đổi trả, rồi lên **đơn nháp để chủ shop duyệt**. Câu nào vượt khả năng thì trợ lý báo chủ shop chứ không tự bịa. Mỗi hội thoại được chấm điểm để chủ shop dạy thêm, và chủ shop điều khiển nhanh qua **Zalo hoặc Lark**.

---

## Trợ lý làm được những gì?

| Tính năng | Cách hoạt động |
|---|---|
| Trực 3 kênh trên 1 dashboard | Webhook Facebook, Zalo OA và widget web cùng đổ vào một hộp thư. Dashboard cập nhật trực tiếp qua SSE |
| Tư vấn, báo giá đúng catalog | Trợ lý **bắt buộc gọi công cụ tra catalog** trước khi báo giá. Giá, tồn kho, phí ship do code tính từ dữ liệu shop, không do AI tự đặt |
| Trả lời ship, đổi trả, thanh toán | Chỉ dựa trên chính sách chủ shop nhập ở tab *Cài đặt*. Chính sách nào trống thì trợ lý chuyển cho chủ shop |
| Lên đơn nháp | Kiểm tra SĐT, biến thể, tồn kho rồi tạo đơn ở trạng thái **chờ duyệt**. Chủ shop nhận thông báo; duyệt xong khách được báo tự động |
| Không bịa, biết chuyển người | Công cụ `escalate_to_human` gắn cờ "Cần bạn", báo qua Zalo/Lark kèm lệnh trả lời nhanh |
| Điều khiển nhanh | Tạm dừng, duyệt đơn, trả lời thay khách, dạy bài học — tất cả bằng tin nhắn Zalo/Lark |
| Chấm điểm hội thoại | AI chấm 5 tiêu chí (chính xác, hữu ích, giọng điệu, bán hàng, có bịa không). Chủ shop chấm thêm số sao |
| Tự học | Câu trả lời của chủ shop được rút thành kiến thức. Câu hỏi AI chưa trả lời được thì gom thành danh sách cần dạy. Góp ý được rút thành bài học đưa vào hướng dẫn của AI |

## Chạy thử trên máy thế nào?

Cần **Node.js 20 trở lên**:

```bash
npm install
cp .env.example .env      # điền ANTHROPIC_API_KEY và ADMIN_TOKEN
npm start
```

- Dashboard: `http://localhost:3000` (đăng nhập bằng `ADMIN_TOKEN`)
- Trang demo chat web: `http://localhost:3000/demo.html`
- Lần chạy đầu, hệ thống tự nạp **dữ liệu mẫu** từ `data/seed.json` (6 sản phẩm thời trang). Hãy thay bằng catalog thật của shop.
- Kiểm thử: `npm test` (18 bài test, dùng LLM giả nên không tốn phí API)

Chưa có `ANTHROPIC_API_KEY` thì hệ thống vẫn chạy, nhưng mọi tin nhắn sẽ được chuyển cho chủ shop.

## Kết nối từng kênh ra sao?

Server phải có địa chỉ HTTPS công khai (`PUBLIC_URL`). Khi chạy thử có thể dùng ngrok hoặc Cloudflare Tunnel.

### Facebook Messenger kết nối thế nào?

1. Tạo app tại developers.facebook.com, thêm sản phẩm **Messenger** và gắn với Fanpage.
2. Lấy **Page Access Token** điền vào `FB_PAGE_ACCESS_TOKEN`, rồi lấy **App Secret** điền vào `FB_APP_SECRET`.
3. Webhook: Callback URL `PUBLIC_URL/webhooks/facebook`, Verify token = `FB_VERIFY_TOKEN`, đăng ký sự kiện `messages` và `messaging_postbacks`.
4. Muốn trả lời người ngoài danh sách tester thì app cần được duyệt quyền `pages_messaging`.

### Zalo OA kết nối thế nào?

1. Tạo ứng dụng tại developers.zalo.me và liên kết với Official Account.
2. Điền `ZALO_APP_ID` và `ZALO_APP_SECRET`. Lấy access token và refresh token của OA (qua OAuth v4) điền vào `.env`. Hệ thống **tự làm mới token** khi hết hạn và lưu token mới vào `data/db.json`.
3. Webhook: `PUBLIC_URL/webhooks/zalo`, bật sự kiện *người dùng gửi tin nhắn*. Điền **OA Secret Key** vào `ZALO_OA_SECRET_KEY` để xác thực chữ ký.
4. **Chủ shop điều khiển qua Zalo:** quan tâm OA bằng Zalo cá nhân, nhắn `/id` để lấy ID, rồi điền ID đó vào `ZALO_OWNER_IDS`.

> ⚠️ Zalo chỉ cho OA gửi tin tư vấn tới người đã tương tác với OA trong **7 ngày** gần nhất. Chủ shop nên nhắn OA định kỳ (ví dụ gõ `/baocao` mỗi sáng) để vẫn nhận được thông báo.

### Web chat gắn vào website thế nào?

Dán một dòng vào website (WordPress, Haravan, Sapo, trang HTML…):

```html
<script src="https://PUBLIC_URL/widget.js" defer></script>
```

### Lark điều khiển thế nào?

1. Tạo **Custom App** tại open.larksuite.com, bật **Bot**, cấp quyền `im:message` và `im:message:send_as_bot`.
2. Điền `LARK_APP_ID` và `LARK_APP_SECRET`. Ở phần Event Subscriptions: Request URL `PUBLIC_URL/webhooks/lark`, sự kiện `im.message.receive_v1`, chép **Verification Token** vào `LARK_VERIFICATION_TOKEN`. Không bật Encrypt Key.
3. Nhắn bot một tin bất kỳ. Bot trả về Chat ID; điền Chat ID đó vào `LARK_OWNER_CHAT_IDS` rồi khởi động lại.

## Điều khiển nhanh bằng những lệnh nào?

Các lệnh dùng được trên Zalo, Lark và ô lệnh trong *Cài đặt* của dashboard. Trên Lark có thể bỏ dấu `/`.

| Lệnh | Tác dụng |
|---|---|
| `/tamdung` · `/tieptuc` | Tạm dừng / bật lại AI trên mọi kênh |
| `/tamdung C12` · `/tieptuc C12` | Dừng / trả lại AI cho riêng hội thoại C12 |
| `/tl C12 <nội dung>` | Trả lời khách thay AI. AI im ở hội thoại đó **30 phút** (`HUMAN_TAKEOVER_MINUTES`) |
| `/cho` | Danh sách hội thoại đang chờ bạn |
| `/don` · `/duyet D5` · `/huy D5 <lý do>` | Xem, duyệt, huỷ đơn nháp (khách được báo tự động) |
| `/xem C12` | Xem 6 tin nhắn gần nhất |
| `/cham C12` · `/diem C12 4 <ghi chú>` | AI chấm điểm · bạn chấm 1-5 sao |
| `/day C12 <góp ý>` · `/day <góp ý>` | Dạy trợ lý một bài học mới |
| `/baocao` | Thống kê trong ngày |

## Trợ lý tự học và tiến bộ dần như thế nào?

1. **Học từ câu trả lời của chủ shop:** khi bạn trả lời một câu trợ lý đã chuyển lên (bằng `/tl` hoặc trên dashboard), AI rút thành một mục hỏi-đáp tổng quát và bỏ thông tin cá nhân. Mục này **chờ duyệt** ở tab *Kiến thức*; nếu bật "Tự dùng kiến thức" trong Cài đặt thì dùng được ngay.
2. **Gom câu hỏi còn thiếu:** khi chấm điểm, AI liệt kê các câu khách hỏi mà dữ liệu shop chưa có. Câu hỏi lặp lại được đếm số lần hỏi để bạn ưu tiên trả lời câu hỏi nhiều nhất.
3. **Bài học từ góp ý:** mỗi góp ý (nút *Dạy* hoặc lệnh `/day`) được viết lại thành một quy tắc ngắn và đưa thẳng vào hướng dẫn của trợ lý cho mọi hội thoại sau. Bật/tắt từng bài ở tab *Bài học*.
4. **Chấm điểm tự động:** cứ **30 phút** (`LEARNING_INTERVAL_MINUTES`), hệ thống chấm các hội thoại đã im lặng ít nhất 30 phút. Hội thoại có điểm dưới ngưỡng (mặc định **6/10**) hoặc có dấu hiệu bịa sẽ được báo về Zalo/Lark.

## Nhập catalog bằng cách nào?

Tab **Catalog** có 3 cách: thêm tay, sửa từng sản phẩm, hoặc **nhập CSV** xuất từ Excel/Google Sheets. Sản phẩm trùng mã thì được cập nhật.

```csv
id,name,category,price,salePrice,stock,description,tags,variants,attr:Chất liệu
AT01,Áo thun nam Basic,Áo nam,199000,,,"Cotton 220gsm",áo phông,"Trắng-M:12;Trắng-L:8;Đen-L:5",Cotton 100%
PK01,Tất cổ ngắn (5 đôi),Phụ kiện,89000,,40,,,,
```

`variants` có dạng `tên:tồn kho[:giá riêng]`, các biến thể cách nhau bằng dấu `;`.

## Cấu trúc mã nguồn gồm những gì?

```
src/
  server.js            Khởi động Express, chu kỳ tự học
  config.js, db.js     Cấu hình .env, kho dữ liệu JSON (data/db.json)
  catalog.js           Tìm kiếm không dấu, giá, tồn kho
  importers.js         Nhập CSV
  agent/
    llm.js             Gọi Claude API (có fallback phía server khi bị từ chối)
    agent.js           System prompt + vòng lặp gọi công cụ
    tools.js           Tra catalog, chính sách, phí ship, kiến thức, tạo đơn nháp, chuyển người
    learning.js        Chấm điểm, rút kiến thức, bài học, chu kỳ tự học
  core/hub.js          Điều phối tin nhắn mọi kênh, tiếp quản, duyệt đơn, thông báo
  channels/            facebook.js, zalo.js, lark.js
  control/             commands.js (lệnh nhanh), notifier.js
  routes/              webhooks.js, webchat.js, admin.js
public/                Dashboard (index.html, app.js, style.css), widget.js, demo.html
data/seed.json         Dữ liệu mẫu
test/                  Kiểm thử với LLM giả
```

## Triển khai thực tế cần lưu ý gì?

- **Đổi `ADMIN_TOKEN`** thành chuỗi dài, ngẫu nhiên, và luôn chạy sau HTTPS.
- Dữ liệu nằm trong `data/db.json`. Hãy sao lưu file này định kỳ. Kho JSON phù hợp với quy mô **một shop, vài nghìn hội thoại mỗi tháng**; khi lớn hơn nên chuyển `db.js` sang Postgres/SQLite.
- Chỉ chạy **1 tiến trình** (kho JSON không chia sẻ được giữa nhiều tiến trình). Dùng `pm2 start src/server.js` hoặc Docker với volume gắn vào `data/`.
- Mặc định model là `claude-opus-5-5`. Muốn đổi model thì sửa `CLAUDE_MODEL`; muốn trả lời nhanh và rẻ hơn thì hạ `CHAT_EFFORT=low`.

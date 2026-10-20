# Hồ sơ xét duyệt ứng dụng Meta (Facebook Messenger)

Mục tiêu: để trợ lý trả lời **mọi khách** nhắn vào các Trang EIV, không chỉ tài khoản có vai trò trong ứng dụng.
Cần 3 việc: **xác minh doanh nghiệp** → **xin quyền truy cập nâng cao** cho 4 quyền → **chuyển ứng dụng sang Live**.

> ⚠️ Giao diện Meta đổi thường xuyên; tên nút có thể khác đôi chút. Thời gian duyệt tuỳ Meta (thường vài ngày đến vài tuần). Hồ sơ bị từ chối thì sửa theo góp ý và nộp lại.

---

## Bước 0 — Chuẩn bị (kiểm tra trước khi nộp)

| Mục | Ở đâu | Yêu cầu |
|---|---|---|
| Biểu tượng ứng dụng (1024×1024) | Cài đặt ứng dụng → Thông tin cơ bản | Logo EIV |
| URL chính sách quyền riêng tư | như trên | `https://agentai.eiv.edu.vn/privacy` (mở được, có email liên hệ) |
| URL hướng dẫn xoá dữ liệu | như trên | `https://agentai.eiv.edu.vn/data-deletion` |
| Hạng mục | như trên | Giáo dục |
| Email liên hệ | như trên | Email công việc (Meta gửi kết quả duyệt về đây) |
| Gắn với Business Portfolio | Cài đặt ứng dụng → Thông tin cơ bản / Bảng điều khiển | Business Portfolio của EIV |
| Đã gọi thử từng quyền | Quyền và tính năng → cột số lần gọi | Mỗi quyền **> 0** (kết nối Trang + nhắn thử là đủ; số liệu có thể cập nhật sau ~24 giờ) |

## Bước 1 — Xác minh doanh nghiệp (Business Verification)

1. Vào **business.facebook.com** → **Cài đặt** (Business settings) → **Trung tâm bảo mật** (Security Center) → **Bắt đầu xác minh**.
2. Điền đúng như giấy phép kinh doanh: tên pháp lý công ty, địa chỉ, số điện thoại, website `eiv.edu.vn`.
3. Tải **giấy chứng nhận đăng ký doanh nghiệp** (bản scan rõ, đúng tên pháp lý).
4. Chọn cách xác nhận: email tên miền `@eiv.edu.vn` (nhanh nhất), điện thoại hoặc DNS.

## Bước 2 — Xin quyền truy cập nâng cao (App Review)

developers.facebook.com → ứng dụng **AgentAI EIV** → **Xét duyệt** → **Yêu cầu** (hoặc *Quyền và tính năng* → **Hành động** → **Yêu cầu quyền truy cập nâng cao**) cho 4 quyền dưới. Mỗi quyền có ô mô tả + video; dán nội dung tương ứng.

### pages_messaging

> EIV Education uses this app as an AI customer-service assistant for its own Facebook Pages (English courses with foreign teachers). When a person sends a message to one of our Pages, the app receives it through the Messenger webhook and replies within the 24-hour standard messaging window with information about our courses, using only our official course data. When the question needs a human, the conversation is handed to our staff, who reply from the app's dashboard. We only send messages in response to user-initiated conversations; we do not send promotional or unsolicited messages.

### pages_manage_metadata

> We use this permission to subscribe our app to the Page's messaging webhooks (`messages`, `messaging_postbacks`) when a Page administrator turns the assistant on for a Page in our dashboard, and to unsubscribe when they turn it off. This is required for the app to receive incoming Messenger messages for the Pages our business manages.

### pages_show_list

> After a Page administrator logs in with Facebook in our dashboard, we use this permission to list the Pages they manage so they can choose which of our business's Pages the assistant should answer. Only Pages the administrator selects and turns on are used.

### pages_read_engagement

> We use this permission to read basic Page information (Page name) and the public profile name of the person messaging the Page, so our staff can see who they are talking to and which Page the conversation came from (for example "EIV for Kids"). The name is stored only in our internal customer-service records and is never shared with third parties.

### Hướng dẫn thử cho người duyệt (ô *Test instructions*)

> 1. Open https://www.facebook.com/<link Trang EIV for Kids> and click "Message".
> 2. Send any question, e.g. "Do you have English classes for a 6-year-old?" — the assistant replies within about 20 seconds in Vietnamese, the language of our customers.
> 3. Our admin dashboard (shown in the screencast) displays the conversation, the Page it came from, and lets staff reply or turn the assistant off per Page.
> The dashboard is an internal tool for our staff, so reviewers do not need to log in to it; the screencast shows the full Facebook Login and Page selection flow.

*(Thay `<link Trang EIV for Kids>` bằng link thật của Trang. Bật trợ lý cho Trang đó trước khi nộp.)*

## Bước 3 — Video quay màn hình (screencast)

Một video 2–4 phút dùng chung cho cả 4 quyền là được (hoặc cắt theo từng quyền). Nên thêm **phụ đề tiếng Anh** ngắn ở mỗi bước vì dashboard là tiếng Việt. Quay bằng OBS / Loom / công cụ quay màn hình của Windows (Win+G).

| Thời điểm | Quay gì | Phụ đề (tiếng Anh) | Chứng minh quyền |
|---|---|---|---|
| 0:00 | Mở dashboard `agentai.eiv.edu.vn` → Cài đặt → **Kết nối Facebook** | "Admin connects the business's Facebook Pages" | — |
| 0:20 | Hộp thoại đăng nhập Facebook → chọn các Trang EIV → hiện danh sách quyền → **Cho phép** | "Facebook Login: admin selects Pages and grants permissions" | pages_show_list |
| 0:50 | Quay lại dashboard: danh sách Trang → **tick bật** EIV for Kids | "Admin turns the assistant on for a Page (subscribes webhooks)" | pages_manage_metadata |
| 1:10 | Điện thoại/tài khoản khác nhắn Trang EIV for Kids: "Bé 6 tuổi học được không?" | "A customer messages the Page" | — |
| 1:30 | Messenger hiện câu trả lời của trợ lý | "The assistant replies in Messenger" | pages_messaging |
| 1:50 | Dashboard → Hội thoại: thấy tên khách + tên Trang | "Staff dashboard shows the customer's name and source Page" | pages_read_engagement |
| 2:10 | Nhân viên gõ trả lời thay trong dashboard → khách nhận được | "Staff can reply as a human" | pages_messaging |
| 2:30 | Bỏ tick Trang → nhắn lại → trợ lý không trả lời | "Turning a Page off unsubscribes it" | pages_manage_metadata |

Lưu ý khi quay: che hoặc làm mờ mật khẩu dashboard và token; dùng tài khoản khách thử (không lộ thông tin khách thật).

## Bước 4 — Sau khi được duyệt

1. **Đăng** (Publish) ứng dụng: menu trái → **Đăng** → chuyển sang **Live**.
2. Nhắn thử từ một tài khoản **không** có vai trò trong ứng dụng → trợ lý phải trả lời.
3. Theo dõi sát 2–3 ngày đầu (tab Hội thoại, Nhật ký); có vấn đề thì `/tamdung`.

## Quy định cần nhớ khi chạy thật

- **Cửa sổ 24 giờ**: trợ lý chỉ trả lời trong vòng 24 giờ kể từ tin cuối của khách (tin nhắc sau 1 giờ của trợ lý nằm trong khung này). Không gửi tin quảng cáo ngoài 24 giờ.
- Khách yêu cầu nói chuyện với người thật → trợ lý chuyển cho nhân viên (đã có sẵn).
- Khách yêu cầu xoá dữ liệu → trợ lý chuyển cho quản lý; xử lý trong 30 ngày như trang `/data-deletion` cam kết.

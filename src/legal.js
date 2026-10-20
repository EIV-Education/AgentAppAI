// Trang Chính sách quyền riêng tư và Hướng dẫn xóa dữ liệu (Meta/Zalo yêu cầu khi duyệt ứng dụng).
// Nội dung là mẫu theo đúng cách trợ lý xử lý dữ liệu — chủ đơn vị nên đọc lại trước khi nộp.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(title, body) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px/1.65 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#1d2330;background:#fff}h1{font-size:26px}h2{font-size:19px;margin-top:28px}li{margin:4px 0}.muted{color:#6b7280;font-size:14px}</style></head><body>${body}</body></html>`;
}

function contact(shop) {
  return [shop.email && `Email: <a href="mailto:${esc(shop.email)}">${esc(shop.email)}</a>`, shop.hotline && `Hotline: ${esc(shop.hotline)}`]
    .filter(Boolean).join(' · ') || 'qua chính các kênh nhắn tin (Facebook, Zalo, website) mà bạn đã liên hệ';
}

export function privacyPage(shop, updatedAt) {
  const name = esc(shop.name);
  return page(`Chính sách quyền riêng tư – ${shop.name}`, `
<h1>Chính sách quyền riêng tư</h1>
<p class="muted">${name} · Cập nhật: ${esc(updatedAt)}</p>
<p>Chính sách này mô tả cách ${name} thu thập, sử dụng và bảo vệ thông tin khi bạn nhắn tin với chúng tôi qua Facebook Messenger, Zalo Official Account hoặc khung chat trên website, nơi một trợ lý tư vấn tự động (AI) hỗ trợ trả lời.</p>
<h2>1. Thông tin chúng tôi thu thập</h2>
<ul>
<li>Mã định danh tài khoản trên nền tảng (ID Messenger theo Trang, ID Zalo theo OA) và tên hiển thị công khai.</li>
<li>Nội dung tin nhắn bạn gửi và câu trả lời của chúng tôi.</li>
<li>Thông tin bạn tự cung cấp để được tư vấn: số điện thoại/Zalo, email, khu vực/địa chỉ, nhu cầu học tập, tên trường/đơn vị (nếu có).</li>
</ul>
<h2>2. Mục đích sử dụng</h2>
<ul>
<li>Trả lời câu hỏi và tư vấn dịch vụ phù hợp với nhu cầu của bạn.</li>
<li>Chuyển thông tin liên hệ cho chuyên viên tư vấn của ${name} để liên hệ lại khi bạn đồng ý để lại thông tin.</li>
<li>Nâng cao chất lượng tư vấn (đánh giá hội thoại, rút kinh nghiệm); khi dùng làm mẫu đào tạo, số điện thoại và email được xoá.</li>
</ul>
<p>Chúng tôi không bán thông tin của bạn và không dùng cho mục đích quảng cáo của bên thứ ba.</p>
<h2>3. Chia sẻ với bên thứ ba</h2>
<ul>
<li>Nội dung tin nhắn được xử lý bởi nhà cung cấp mô hình AI (Anthropic) để tạo câu trả lời.</li>
<li>Thông tin khách hàng tiềm năng được lưu trong hệ thống quản lý khách hàng nội bộ của ${name}.</li>
<li>Meta (Facebook) và Zalo xử lý tin nhắn theo chính sách riêng của họ.</li>
</ul>
<h2>4. Lưu trữ và bảo mật</h2>
<p>Dữ liệu được lưu trên máy chủ do ${name} quản lý, truy cập giới hạn cho nhân sự được phân quyền, truyền qua kết nối mã hoá (HTTPS).</p>
<h2>5. Quyền của bạn</h2>
<p>Bạn có quyền yêu cầu xem, chỉnh sửa hoặc xoá dữ liệu của mình bất cứ lúc nào. Xem <a href="/data-deletion">hướng dẫn xoá dữ liệu</a>.</p>
<h2>6. Liên hệ</h2>
<p>${contact(shop)}</p>`);
}

export function dataDeletionPage(shop) {
  const name = esc(shop.name);
  return page(`Hướng dẫn xóa dữ liệu – ${shop.name}`, `
<h1>Hướng dẫn yêu cầu xoá dữ liệu</h1>
<p class="muted">${name}</p>
<p>Bạn có thể yêu cầu xoá toàn bộ dữ liệu ${name} đã lưu khi bạn nhắn tin qua Facebook Messenger, Zalo hoặc khung chat website (lịch sử tin nhắn, tên hiển thị, thông tin liên hệ bạn đã cung cấp).</p>
<h2>Cách gửi yêu cầu</h2>
<ol>
<li>Nhắn tin trực tiếp cho Trang/OA mà bạn đã trò chuyện với nội dung: <b>"Yêu cầu xoá dữ liệu"</b>, hoặc</li>
<li>Liên hệ: ${contact(shop)} — ghi rõ kênh bạn đã nhắn (Facebook/Zalo/website) và tên hiển thị.</li>
</ol>
<p>Chúng tôi xác nhận và xoá dữ liệu trong vòng 30 ngày kể từ khi nhận yêu cầu, rồi thông báo lại cho bạn.</p>
<h2>Gỡ quyền trên Facebook</h2>
<p>Bạn cũng có thể vào Cài đặt Facebook → Ứng dụng và trang web → chọn ứng dụng của ${name} → Gỡ.</p>`);
}

import { searchProducts, searchKnowledge, effectivePrice, stockOf, normalize, formatVnd } from '../catalog.js';

// Công cụ trợ lý được dùng. Mọi giá, tồn kho, phí ship đều do code tính từ dữ liệu shop —
// model không bao giờ tự đặt giá.

export const TOOL_DEFS = [
  {
    name: 'search_products',
    description: 'Tìm sản phẩm trong catalog của shop theo từ khoá, danh mục, khoảng giá. Luôn gọi trước khi giới thiệu hay báo giá bất kỳ sản phẩm nào.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Từ khoá khách hỏi, vd "áo thun nam trắng"' },
        category: { type: 'string' },
        min_price: { type: 'number', description: 'VND' },
        max_price: { type: 'number', description: 'VND' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_product',
    description: 'Xem chi tiết một sản phẩm (mô tả, thuộc tính, biến thể, giá, tồn kho) theo mã.',
    input_schema: {
      type: 'object',
      properties: { product_id: { type: 'string' } },
      required: ['product_id'],
    },
  },
  {
    name: 'get_shop_policy',
    description: 'Lấy chính sách của shop: giao hàng, đổi trả, thanh toán, bảo hành, thông tin shop.',
    input_schema: {
      type: 'object',
      properties: { topic: { type: 'string', enum: ['shipping', 'returns', 'payment', 'warranty', 'shop_info'] } },
      required: ['topic'],
    },
  },
  {
    name: 'calculate_shipping',
    description: 'Tính phí ship và thời gian giao dự kiến tới một tỉnh/thành cho một giá trị đơn hàng.',
    input_schema: {
      type: 'object',
      properties: {
        province: { type: 'string', description: 'Tỉnh/thành phố nhận hàng' },
        order_value: { type: 'number', description: 'Tổng tiền hàng (VND)' },
      },
      required: ['province'],
    },
  },
  {
    name: 'search_knowledge',
    description: 'Tra cứu kho kiến thức shop đã dạy (câu hỏi thường gặp, cách dùng, mẹo chọn size...). Gọi khi câu hỏi không nằm trong catalog/chính sách.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'create_draft_order',
    description: 'Tạo ĐƠN NHÁP khi khách đã chốt mua và cung cấp đủ tên, SĐT, địa chỉ. Đơn chỉ có hiệu lực sau khi chủ shop duyệt.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product_id: { type: 'string' },
              variant: { type: 'string', description: 'Tên biến thể (size/màu) nếu có' },
              quantity: { type: 'integer', minimum: 1 },
            },
            required: ['product_id', 'quantity'],
          },
        },
        customer_name: { type: 'string' },
        phone: { type: 'string' },
        address: { type: 'string', description: 'Địa chỉ đầy đủ kèm tỉnh/thành' },
        province: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['items', 'customer_name', 'phone', 'address', 'province'],
    },
  },
  {
    name: 'create_lead',
    description: 'Lưu KHÁCH TIỀM NĂNG khi khách đã cho số điện thoại/Zalo, để chuyên viên tư vấn liên hệ. Gọi ngay khi có SĐT, kèm mọi nhu cầu khách đã chia sẻ. Gọi lại với cùng SĐT để bổ sung thông tin (email, khu vực...).',
    input_schema: {
      type: 'object',
      properties: {
        segment: { type: 'string', enum: ['school_center', 'business', 'kids', 'adult', 'other'], description: 'Nhóm khách: trường học/trung tâm, doanh nghiệp, cá nhân trẻ em, cá nhân người đi làm, khác' },
        contact_name: { type: 'string', description: 'Tên người liên hệ khách tự giới thiệu (hệ thống ưu tiên tên Zalo/Facebook nếu có)' },
        organization: { type: 'string', description: 'Tên trường học / trung tâm / doanh nghiệp (bắt buộc hỏi với khách trường học, trung tâm)' },
        phone: { type: 'string', description: 'Số điện thoại hoặc Zalo' },
        email: { type: 'string' },
        area: { type: 'string', description: 'Tỉnh/thành, khu vực' },
        address: { type: 'string', description: 'Địa chỉ cụ thể nếu khách cho (số nhà, đường, quận...)' },
        needs: { type: 'string', description: 'Tóm tắt nhu cầu: độ tuổi, mục tiêu, hình thức học, quy mô, cấp trường... đúng như khách nói' },
        service_id: { type: 'string', description: 'Mã dịch vụ/khoá học trong catalog nếu xác định được' },
      },
      required: ['segment', 'phone', 'needs'],
    },
  },
  {
    name: 'escalate_to_human',
    description: 'Chuyển câu hỏi cho chủ shop khi: không tìm thấy thông tin trong dữ liệu shop, khách khiếu nại/giận dữ, yêu cầu giảm giá ngoài chính sách, hỏi việc ngoài khả năng. Không được tự bịa câu trả lời.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', enum: ['missing_info', 'complaint', 'discount_request', 'out_of_scope', 'customer_request', 'other'] },
        question: { type: 'string', description: 'Tóm tắt điều khách cần, đủ để chủ shop trả lời ngay' },
      },
      required: ['reason', 'question'],
    },
  },
];

const PHONE_RE = /^(0|\+84)(3|5|7|8|9)\d{8}$/;

function productSummary(p) {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    price: effectivePrice(p),
    price_text: formatVnd(effectivePrice(p)),
    original_price: p.salePrice != null ? p.price : undefined,
    in_stock: stockOf(p) == null ? 'không rõ' : stockOf(p) > 0,
    variants: (p.variants || []).map((v) => ({ name: v.name, price: v.price ?? effectivePrice(p), in_stock: (v.stock ?? 1) > 0 })),
  };
}

export function quoteShipping(settings, province, orderValue = 0) {
  const rules = settings.shippingRules || {};
  const zones = rules.zones || [];
  const np = normalize(province);
  const zone = zones.find((z) => (z.provinces || []).some((p) => np.includes(normalize(p)) || normalize(p).includes(np)))
    || zones.find((z) => !(z.provinces || []).length);
  if (!zone) return null;
  const free = rules.freeShipThreshold > 0 && orderValue >= rules.freeShipThreshold;
  return { zone: zone.name, fee: free ? 0 : zone.fee, days: zone.days, free_ship_threshold: rules.freeShipThreshold || null };
}

// ctx: { store, conversation, hooks: { onEscalate, onOrder } }
export async function runTool(name, input, ctx) {
  const { store } = ctx;
  const settings = store.settings;
  switch (name) {
    case 'search_products': {
      const found = searchProducts(store.all('products'), {
        query: input.query, category: input.category, maxPrice: input.max_price, minPrice: input.min_price,
      });
      if (!found.length) return { found: 0, note: 'Không có sản phẩm phù hợp trong catalog. Không được giới thiệu sản phẩm ngoài danh sách.' };
      return { found: found.length, products: found.map(productSummary) };
    }
    case 'get_product': {
      const p = store.get('products', input.product_id);
      if (!p || p.active === false) return { error: 'Không tìm thấy sản phẩm với mã này.' };
      return { ...productSummary(p), description: p.description, attributes: p.attributes, stock: stockOf(p), images: p.images };
    }
    case 'get_shop_policy': {
      if (input.topic === 'shop_info') return settings.shop;
      const text = settings.policies?.[input.topic];
      if (!text) return { error: 'Shop chưa cấu hình chính sách này. Hãy chuyển cho chủ shop (escalate_to_human).' };
      const extra = input.topic === 'shipping' ? { shipping_rules: settings.shippingRules } : {};
      return { policy: text, ...extra };
    }
    case 'calculate_shipping': {
      const q = quoteShipping(settings, input.province, input.order_value || 0);
      if (!q) return { error: 'Chưa có bảng phí ship cho khu vực này. Hãy chuyển cho chủ shop.' };
      return { ...q, fee_text: formatVnd(q.fee) };
    }
    case 'search_knowledge': {
      const hits = searchKnowledge(store.all('knowledge'), input.query);
      if (!hits.length) return { found: 0 };
      return { found: hits.length, entries: hits.map((k) => ({ question: k.question, answer: k.answer })) };
    }
    case 'create_draft_order': {
      const phone = String(input.phone || '').replace(/[\s.-]/g, '');
      if (!PHONE_RE.test(phone)) return { error: 'Số điện thoại không hợp lệ, hãy hỏi lại khách.' };
      const lines = [];
      for (const it of input.items || []) {
        const p = store.get('products', it.product_id);
        if (!p || p.active === false) return { error: `Mã sản phẩm ${it.product_id} không tồn tại.` };
        if (p.variants?.length) {
          if (!it.variant) return { error: `Sản phẩm ${p.name} có các lựa chọn: ${p.variants.map((v) => v.name).join(', ')}. Hãy hỏi khách chọn.` };
          if (!p.variants.some((v) => normalize(v.name) === normalize(it.variant))) {
            return { error: `Không có lựa chọn "${it.variant}" cho ${p.name}. Có: ${p.variants.map((v) => v.name).join(', ')}.` };
          }
        }
        const stock = stockOf(p, it.variant);
        if (stock != null && stock < it.quantity) return { error: `${p.name} ${it.variant || ''} chỉ còn ${stock} sản phẩm.` };
        const unit = effectivePrice(p, it.variant);
        lines.push({ productId: p.id, name: p.name, variant: it.variant || null, quantity: it.quantity, unitPrice: unit, total: unit * it.quantity });
      }
      if (!lines.length) return { error: 'Đơn chưa có sản phẩm.' };
      const subtotal = lines.reduce((a, l) => a + l.total, 0);
      const ship = quoteShipping(settings, input.province, subtotal);
      const order = store.insert('orders', {
        status: 'pending',
        conversationId: ctx.conversation.id,
        channel: ctx.conversation.channel,
        customer: { name: input.customer_name, phone, address: input.address, province: input.province },
        items: lines,
        subtotal,
        shippingFee: ship?.fee ?? null,
        total: subtotal + (ship?.fee ?? 0),
        note: input.note || '',
      });
      await ctx.hooks?.onOrder?.(order);
      return {
        order_id: order.id,
        status: 'Đơn nháp — chờ shop xác nhận',
        items: lines.map((l) => `${l.name}${l.variant ? ` (${l.variant})` : ''} x${l.quantity} = ${formatVnd(l.total)}`),
        subtotal: formatVnd(subtotal),
        shipping_fee: ship ? formatVnd(ship.fee) : 'shop sẽ báo sau',
        total: formatVnd(order.total),
        instruction: 'Tóm tắt đơn cho khách và nói rõ shop sẽ gọi/nhắn xác nhận. KHÔNG nói đơn đã được xác nhận.',
      };
    }
    case 'create_lead': {
      const phone = String(input.phone || '').replace(/[\s.()-]/g, '');
      if (!PHONE_RE.test(phone)) return { error: 'Số điện thoại/Zalo chưa hợp lệ (cần 10 số, bắt đầu bằng 0 hoặc +84). Hãy hỏi lại khách.' };
      const email = String(input.email || '').trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Email chưa đúng định dạng, hãy hỏi lại khách.' };
      const fields = {
        // Người liên hệ: tên Zalo/Facebook của tài khoản đang nhắn; web chat không có thì dùng tên khách tự giới thiệu
        segment: input.segment, contactName: store.get('conversations', ctx.conversation.id)?.customerName || input.contact_name || '', phone,
        organization: input.organization || '',
        email, area: input.area || '', address: input.address || '', needs: input.needs || '', serviceId: input.service_id || '',
      };
      const existing = store.find('leads', (l) => l.phone === phone && l.conversationId === ctx.conversation.id)[0];
      if (existing) {
        const merged = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v || existing[k]]));
        const updated = store.update('leads', existing.id, merged);
        await ctx.hooks?.onLeadUpdate?.(updated);
        return { lead_id: existing.id, status: 'Đã cập nhật thông tin khách', instruction: 'Cảm ơn khách, không cần hỏi lại thông tin đã có.' };
      }
      const lead = store.insert('leads', { status: 'new', conversationId: ctx.conversation.id, channel: ctx.conversation.channel, ...fields });
      await ctx.hooks?.onLead?.(lead);
      return { lead_id: lead.id, status: 'Đã chuyển cho chuyên viên tư vấn', instruction: 'Xác nhận đã tiếp nhận, chuyên viên sẽ liên hệ sớm. Không hứa thời gian hay giá cụ thể.' };
    }
    case 'escalate_to_human': {
      store.update('conversations', ctx.conversation.id, {
        needsHuman: true,
        escalation: { reason: input.reason, question: input.question, at: new Date().toISOString() },
      });
      await ctx.hooks?.onEscalate?.(ctx.conversation, input);
      return { ok: true, instruction: 'Đã báo chủ shop. Nói với khách là em đã chuyển câu hỏi cho quản lý và sẽ phản hồi sớm. Không tự đưa ra câu trả lời cho phần này.' };
    }
    default:
      return { error: `Công cụ không tồn tại: ${name}` };
  }
}

// Bộ công cụ theo chế độ: shop bán hàng có đơn nháp + phí ship; chế độ khách tiềm năng thì không
const ORDER_ONLY = new Set(['create_draft_order', 'calculate_shipping']);
export function toolsFor(mode) {
  return mode === 'lead' ? TOOL_DEFS.filter((t) => !ORDER_ONLY.has(t.name)) : TOOL_DEFS;
}

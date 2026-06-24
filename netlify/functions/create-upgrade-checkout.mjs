import { getAuthContext } from "./_auth.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

// Tạo checkout session cho Plan "Leaderboard Pro" của CHÍNH app này (không
// phải sản phẩm của tenant) — admin bấm "Upgrade to Paid" trong admin.html sẽ
// gọi endpoint này lấy session id để nhúng Checkout Embed.
//
// Dùng REST trực tiếp (fetch), KHÔNG dùng @whop/api — bản SDK đang cài
// (^0.0.23) chỉ có chargeUser (charge 1 lần theo amount, không gắn Plan) chứ
// không có hàm tạo checkout cho 1 Plan định kỳ có sẵn. Đã xác minh route thật
// bằng request không auth: POST /api/v2/checkout-sessions trả 401 (route có
// thật, đúng version v2 — khác hẳn v5 đang dùng cho memberships/payments ở
// các file khác); /api/v5/checkout_configurations và /api/v5/plans đều 404.
//
// metadata.tenantId là cách DUY NHẤT để webhook.mjs biết khoản thanh toán này
// là nâng cấp Pro của 1 tenant cụ thể (chứ không phải member mua hàng trên
// chính community của tenant đó) — xem _tenant.mjs setTenantTier().
export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Could not identify the user." });
  if (!companyId) return json(400, { error: "Could not identify the community. Please open this page inside Whop." });

  const devApiKey = process.env.WHOP_DEV_API_KEY;
  const planId = process.env.WHOP_PRO_PLAN_ID;
  if (!devApiKey || !planId) {
    return json(500, { error: "Missing WHOP_DEV_API_KEY or WHOP_PRO_PLAN_ID environment variable." });
  }

  try {
    const r = await fetch("https://api.whop.com/api/v2/checkout-sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${devApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        plan_id: planId,
        metadata: { tenantId: companyId },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return json(502, { error: `Whop checkout-sessions error (${r.status}): ${j.error || j.message || JSON.stringify(j)}` });
    }
    // Tên field id thật của response CHƯA xác minh được bằng request thật
    // (cần devApiKey/planId thật) — thử vài đường dẫn hợp lý nhất theo schema
    // GraphQL CreateCheckoutSessionInput (id/planId trên object CheckoutSession).
    const sessionId = j.id || j.data?.id || j.session_id || j.checkout_session?.id || null;
    if (!sessionId) {
      return json(502, { error: "Could not find a session id in the Whop response.", raw: j });
    }
    return json(200, { sessionId });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

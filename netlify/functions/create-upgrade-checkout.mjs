import { getAuthContext } from "./_auth.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

// Tạo 1 Checkout Configuration cho Plan "Leaderboard Pro" của CHÍNH app này
// (không phải sản phẩm của tenant) — admin bấm "Upgrade to Paid" trong
// admin.html sẽ gọi endpoint này lấy session id để nhúng Checkout Embed.
//
// Dùng REST trực tiếp (fetch), KHÔNG dùng @whop/api — bản SDK đang cài
// (^0.0.23) chỉ có chargeUser (charge 1 lần theo amount, không gắn Plan).
// Endpoint + field đã XÁC MINH bằng cách đọc trực tiếp docs.whop.com/llms.txt
// rồi fetch đúng trang .md thật (không suy đoán qua probe không-auth nữa —
// lần trước đoán nhầm /api/v2/checkout-sessions, gây lỗi 401):
//   POST https://api.whop.com/api/v1/checkout_configurations
//   body: { company_id, plan_id, metadata } — company_id là BẮT BUỘC, là
//   company CỦA DEV (biz_xxx, set qua WHOP_DEV_COMPANY_ID) — KHÔNG phải
//   `companyId` lấy từ getAuthContext() dưới đây (đó là tenantId nội bộ của
//   tenant đang nâng cấp, chỉ dùng trong metadata.tenantId).
//   response: { id, company_id, mode, purchase_url, ... } — field "id" là
//   checkout config id, dùng làm `data-whop-checkout-session` ở admin.html.
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
  const devCompanyId = process.env.WHOP_DEV_COMPANY_ID;
  if (!devApiKey || !planId || !devCompanyId) {
    return json(500, { error: "Missing WHOP_DEV_API_KEY, WHOP_PRO_PLAN_ID, or WHOP_DEV_COMPANY_ID environment variable." });
  }

  try {
    const r = await fetch("https://api.whop.com/api/v1/checkout_configurations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${devApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        company_id: devCompanyId,
        plan_id: planId,
        metadata: { tenantId: companyId },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detail = typeof j.error === "string" ? j.error : (j.message || JSON.stringify(j));
      return json(502, { error: `Whop checkout_configurations error (${r.status}): ${detail}` });
    }
    if (!j.id) {
      return json(502, { error: "Could not find an id in the Whop response.", raw: j });
    }
    return json(200, { sessionId: j.id, planId });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

import { getAuthContext, isCompanyAdmin } from "./_auth.mjs";
import { getRealCompanyId } from "./_tokens.mjs";

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
//   body: { plan_id, metadata } — docs nói company_id "required" nhưng đó là
//   cho nhánh tạo Plan MỚI inline (`plan: {...}`); khi đã có `plan_id` có sẵn
//   (trường hợp của mình), Whop trả 400 "Cannot provide company_id for this
//   configuration" nếu vẫn gửi — đã xác nhận bằng lỗi thật, KHÔNG gửi nữa.
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

  // Chỉ admin/owner của company mới được kích hoạt nâng cấp Pro (billing) cho
  // community đó — chặn 1 member thường tự gọi thẳng endpoint này.
  const realCompanyId = await getRealCompanyId(companyId);
  if (!(await isCompanyAdmin(userId, realCompanyId))) {
    return json(403, { error: "Only the community admin can upgrade to Pro." });
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}

  const planMap = {
    growth: process.env.WHOP_GROWTH_PLAN_ID,
    pro:    process.env.WHOP_PRO_PLAN_ID,
    agency: process.env.WHOP_AGENCY_PLAN_ID,
  };
  // Fallback: nếu chỉ có WHOP_PRO_PLAN_ID (cũ), treat targetTier bất kỳ là pro
  const targetTier = body.targetTier || "growth";
  const planId = planMap[targetTier] || planMap.pro || planMap.growth;

  const devApiKey = process.env.WHOP_DEV_API_KEY;
  if (!devApiKey) {
    return json(500, { error: "Missing WHOP_DEV_API_KEY environment variable." });
  }
  if (!planId) {
    return json(500, { error: `No plan configured for tier "${targetTier}". Please set WHOP_${targetTier.toUpperCase()}_PLAN_ID in Netlify env vars.` });
  }

  try {
    const r = await fetch("https://api.whop.com/api/v1/checkout_configurations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${devApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        plan_id: planId,
        metadata: { tenantId: companyId, targetTier },
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
    return json(200, { sessionId: j.id, planId, targetTier });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

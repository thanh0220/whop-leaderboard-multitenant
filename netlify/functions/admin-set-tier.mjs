import { setTenantTier } from "./_tenant.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

// Endpoint TẠM, chỉ dùng nội bộ để bạn tự tay set tier 1 tenant test trước
// khi billing thật được tích hợp (Phase 5). Bảo vệ bằng secret header — không
// liên quan gì tới quyền admin của business trong Whop. Khi có webhook billing
// thật, giữ lại endpoint này như cửa hậu cho support/comp account, KHÔNG xoá.
export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const secret = event.headers?.["x-admin-secret"] || event.headers?.["X-Admin-Secret"];
  if (!secret || secret !== process.env.SUPER_ADMIN_SECRET) {
    return json(401, { error: "Unauthorized" });
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}
  const { companyId, tier } = body;
  if (!companyId || !["free", "paid"].includes(tier)) {
    return json(400, { error: 'Cần { companyId, tier: "free"|"paid" }' });
  }

  await setTenantTier(companyId, tier);
  return json(200, { ok: true, companyId, tier });
};

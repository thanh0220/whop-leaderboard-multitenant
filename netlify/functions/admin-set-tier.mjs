import { setTenantTier, saveTenantConfig } from "./_tenant.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

// Cửa hậu nội bộ cho dev/support — set tier + (tuỳ chọn) cờ unlockAllFeatures
// cho 1 tenant cụ thể, KHÔNG đi qua billing thật. Bảo vệ bằng secret header,
// không liên quan quyền admin Whop của business đó. unlockAllFeatures luôn
// được kiểm tra TRƯỚC tier thật trong isPaidTier() (_tenant.mjs) — tenant nào
// còn cờ này = true (từ trước khi có billing) sẽ luôn hiện "Paid" dù chưa trả
// tiền thật; dùng endpoint này để tắt nó đi lúc cần test đúng luồng Free→Paid.
export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const secret = event.headers?.["x-admin-secret"] || event.headers?.["X-Admin-Secret"];
  if (!secret || secret !== process.env.SUPER_ADMIN_SECRET) {
    return json(401, { error: "Unauthorized" });
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}
  const { companyId, tier, unlockAllFeatures } = body;
  if (!companyId) return json(400, { error: "Requires { companyId }" });

  if (tier !== undefined) {
    if (!["free", "paid"].includes(tier)) {
      return json(400, { error: 'tier must be "free" or "paid".' });
    }
    await setTenantTier(companyId, tier);
  }
  if (unlockAllFeatures !== undefined) {
    await saveTenantConfig(companyId, { unlockAllFeatures: !!unlockAllFeatures });
  }

  return json(200, { ok: true, companyId, tier, unlockAllFeatures });
};

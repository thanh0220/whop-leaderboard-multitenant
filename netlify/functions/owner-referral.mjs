import { getAuthContext, isCompanyAdmin } from "./_auth.mjs";
import { getRealCompanyId } from "./_tokens.mjs";
import { pointsStore, tenantKey } from "./_store.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

// Tạo referral code từ companyId (8 ký tự cuối biz_xxx — unique per Whop tenant)
function makeRefCode(companyId) {
  return String(companyId || "").replace(/[^A-Za-z0-9]/g, "").slice(-8).toLowerCase();
}

export const handler = async (event) => {
  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Unauthorized" });
  if (!companyId) return json(400, { error: "Could not identify community." });

  const store = pointsStore();

  // GET — trả về stats + referral link của tenant này
  if (event.httpMethod === "GET") {
    const realCompanyId = await getRealCompanyId(companyId);
    if (!(await isCompanyAdmin(userId, realCompanyId))) {
      return json(403, { error: "Admin only." });
    }

    const refCode = makeRefCode(companyId);

    // Lưu reverse lookup để POST register tìm được referrer từ code
    try {
      const existingCode = await store.get(tenantKey("owner-ref-code", companyId)).catch(() => null);
      if (!existingCode) {
        await store.set(tenantKey("owner-ref-code", companyId), refCode);
        await store.set(tenantKey("owner-ref-by-code", refCode), companyId);
      }
    } catch (_) {}

    const refList = await store.get(tenantKey("owner-ref-list", companyId), { type: "json" }).catch(() => null) || [];
    const upgradedCount = refList.filter((r) => r.upgradedAt).length;
    const pendingCount  = refList.filter((r) => !r.upgradedAt).length;

    // Lấy site URL từ env hoặc headers
    const host = process.env.URL || process.env.DEPLOY_URL || `https://${event.headers?.host || "yourapp.netlify.app"}`;
    const refLink = `${host}/admin.html?ref=${refCode}`;

    return json(200, {
      refCode,
      refLink,
      referredCount: refList.length,
      upgradedCount,
      pendingCount,
    });
  }

  // POST — { action: "register", referrerCode } — đăng ký khi tenant mới click ref link
  if (event.httpMethod === "POST") {
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch (_) {}

    if (body.action !== "register" || !body.referrerCode) {
      return json(400, { error: "Requires { action: 'register', referrerCode }" });
    }

    const code = String(body.referrerCode).toLowerCase().replace(/[^a-z0-9]/g, "");

    // Tìm referrer từ reverse lookup
    const referrerId = await store.get(tenantKey("owner-ref-by-code", code)).catch(() => null);
    if (!referrerId) {
      return json(404, { error: "Referral code not found." });
    }
    if (referrerId === companyId) {
      return json(400, { error: "Cannot refer yourself." });
    }

    // Idempotent: không ghi đè nếu đã registered
    const existing = await store.get(tenantKey("owner-ref-from", companyId)).catch(() => null);
    if (existing) {
      return json(200, { ok: true, alreadyRegistered: true });
    }

    // Lưu "ai giới thiệu tenant này"
    await store.set(tenantKey("owner-ref-from", companyId), referrerId);

    // Append vào list của referrer
    const listKey = tenantKey("owner-ref-list", referrerId);
    const refList = await store.get(listKey, { type: "json" }).catch(() => null) || [];
    refList.push({ tenantId: companyId, registeredAt: new Date().toISOString(), upgradedAt: null });
    await store.setJSON(listKey, refList);

    return json(200, { ok: true, referrerId });
  }

  return json(405, { error: "GET or POST" });
};

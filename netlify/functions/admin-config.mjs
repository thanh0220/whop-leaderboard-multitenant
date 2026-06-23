import { getAuthContext } from "./_auth.mjs";
import { getTenantConfig, saveTenantConfig } from "./_tenant.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

// GET: trả trạng thái cấu hình (KHÔNG bao giờ trả whopApiKey/setupSecret thật
// ra ngoài, chỉ trả đã-cấu-hình-hay-chưa) — để trang Settings biết hiện form
// nào (lần đầu setup vs. đã có, cần nhập lại setupSecret để sửa).
// POST: lưu whopApiKey/whopCompanyId mới — lần đầu thì set luôn setupSecret;
// lần sau phải gửi đúng setupSecret cũ mới cho sửa.
export const handler = async (event) => {
  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Không xác định được người dùng." });
  if (!companyId) return json(400, { error: "Không xác định được community. Hãy mở trang này bên trong Whop." });

  const cfg = await getTenantConfig(companyId);

  if (event.httpMethod === "GET") {
    return json(200, {
      configured: !!cfg.whopApiKey,
      whopCompanyId: cfg.whopCompanyId || null,
      branding: cfg.branding,
    });
  }

  if (event.httpMethod !== "POST") return json(405, { error: "GET hoặc POST" });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}
  const { whopApiKey, whopCompanyId, setupSecret, newSetupSecret } = body;

  if (cfg.setupSecret) {
    if (setupSecret !== cfg.setupSecret) {
      return json(403, { error: "Sai mật khẩu Settings hiện tại." });
    }
  }
  if (!whopApiKey || !String(whopApiKey).trim()) {
    return json(400, { error: "Vui lòng nhập Company API key." });
  }
  if (!whopCompanyId || !String(whopCompanyId).trim()) {
    return json(400, { error: "Vui lòng nhập Company ID (dạng biz_xxx)." });
  }

  const updated = await saveTenantConfig(companyId, {
    whopApiKey: String(whopApiKey).trim(),
    whopCompanyId: String(whopCompanyId).trim(),
    setupSecret: newSetupSecret ? String(newSetupSecret).trim() : (cfg.setupSecret || null),
  });

  return json(200, { ok: true, configured: true, whopCompanyId: updated.whopCompanyId });
};

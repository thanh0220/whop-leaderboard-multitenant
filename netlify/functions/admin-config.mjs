import { getAuthContext, lastVerifyError } from "./_auth.mjs";
import { getTenantConfig, saveTenantConfig } from "./_tenant.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

// Field nào được phép admin tự sửa qua trang Settings/CMS. Dùng allowlist
// (không spread thẳng body vào saveTenantConfig) để chặn field rác/field lạ
// vô tình hoặc cố ý ghi vào config tenant (vd ghi đè whopApiKey bằng field
// gõ sai tên, hoặc field hoàn toàn không liên quan).
const ALLOWED_KEYS = [
  "branding",
  "points",
  "fx",
  "checkinRewards",
  "dailyQuests",
  "seasonTopRewards",
  "rewards",
  "redeemCodes",
  "unlockAllFeatures",
  "chestRules",
  "events",
];

// GET: trả toàn bộ config tenant (trừ whopApiKey/setupSecret — không bao giờ
// lộ ra ngoài) để trang Settings/CMS render đủ các section.
// POST: nhận { whopApiKey?, whopCompanyId?, ...bất kỳ field nào trong
// ALLOWED_KEYS }, merge từng phần đã gửi (mảng bị thay nguyên cục theo
// deepMerge của _tenant.mjs — caller phải tự gửi cả mảng đầy đủ).
export const handler = async (event) => {
  if (event.queryStringParameters && event.queryStringParameters.debug) {
    const h = event.headers || {};
    const auth = await getAuthContext(event);
    return json(200, {
      debug: true,
      hasTokenHeader: !!(h["x-whop-user-token"] || h["X-Whop-User-Token"]),
      referer: h["referer"] || h["Referer"] || null,
      auth,
      verifyError: lastVerifyError,
    });
  }

  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Không xác định được người dùng." });
  if (!companyId) return json(400, { error: "Không xác định được community. Hãy mở trang này bên trong Whop." });

  const cfg = await getTenantConfig(companyId);

  if (event.httpMethod === "GET") {
    return json(200, {
      configured: !!cfg.whopApiKey,
      whopCompanyId: cfg.whopCompanyId || null,
      branding: cfg.branding,
      points: cfg.points,
      fx: cfg.fx,
      checkinRewards: cfg.checkinRewards,
      dailyQuests: cfg.dailyQuests,
      seasonTopRewards: cfg.seasonTopRewards,
      rewards: cfg.rewards,
      redeemCodes: cfg.redeemCodes,
      unlockAllFeatures: cfg.unlockAllFeatures,
      chestRules: cfg.chestRules,
      events: cfg.events,
    });
  }

  if (event.httpMethod !== "POST") return json(405, { error: "GET hoặc POST" });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}
  const { whopApiKey, whopCompanyId } = body;

  // whopApiKey/whopCompanyId: chỉ validate + áp dụng NẾU có gửi field đó
  // trong request này (để các lần lưu CMS khác — vd chỉ sửa rewards — không
  // bị bắt phải gửi lại API key).
  if (whopApiKey !== undefined && !String(whopApiKey).trim()) {
    return json(400, { error: "Company API key không được để trống." });
  }
  if (whopCompanyId !== undefined && !String(whopCompanyId).trim()) {
    return json(400, { error: "Company ID không được để trống." });
  }

  const partial = {};
  for (const k of ALLOWED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, k)) partial[k] = body[k];
  }
  // Validate nhẹ hình dạng dữ liệu — tránh lưu nhầm kiểu sai làm vỡ trang member.
  for (const k of ["checkinRewards", "dailyQuests", "seasonTopRewards", "rewards", "events"]) {
    if (k in partial && !Array.isArray(partial[k])) {
      return json(400, { error: `${k} phải là 1 mảng (array).` });
    }
  }
  if ("redeemCodes" in partial && (typeof partial.redeemCodes !== "object" || partial.redeemCodes === null || Array.isArray(partial.redeemCodes))) {
    return json(400, { error: "redeemCodes phải là 1 object dạng { code: số xu }." });
  }
  if ("chestRules" in partial && (typeof partial.chestRules !== "object" || partial.chestRules === null || Array.isArray(partial.chestRules))) {
    return json(400, { error: "chestRules phải là 1 object." });
  }

  if (whopApiKey) partial.whopApiKey = String(whopApiKey).trim();
  if (whopCompanyId) partial.whopCompanyId = String(whopCompanyId).trim();

  const updated = await saveTenantConfig(companyId, partial);

  return json(200, {
    ok: true,
    configured: !!updated.whopApiKey,
    whopCompanyId: updated.whopCompanyId,
  });
};

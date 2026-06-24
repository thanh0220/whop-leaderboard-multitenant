import { getAuthContext, lastVerifyError } from "./_auth.mjs";
import { getTenantConfig, saveTenantConfig, isPaidTier } from "./_tenant.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

// Field nào được phép admin tự sửa qua trang Settings/CMS. Dùng allowlist
// (không spread thẳng body vào saveTenantConfig) để chặn field rác/field lạ
// vô tình hoặc cố ý ghi vào config tenant (vd ghi đè whopApiKey bằng field
// gõ sai tên, hoặc field hoàn toàn không liên quan).
// "unlockAllFeatures" KHÔNG nằm trong list này dù vẫn còn trong data model —
// đây là cờ bypass paywall, chỉ dev mới được set (qua admin-set-tier.mjs hoặc
// sửa trực tiếp blob), tuyệt đối không cho admin tự POST tự mở khoá free.
const ALLOWED_KEYS = [
  "branding",
  "points",
  "fx",
  "checkinRewards",
  "seasonTopRewards",
  "rewards",
  "redeemCodes",
  "codesEnabled",
  "chestRules",
  "events",
  "eventsEnabled",
  "milestoneRules",
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
  if (!userId) return json(401, { error: "Could not identify the user." });
  if (!companyId) return json(400, { error: "Could not identify the community. Please open this page inside Whop." });

  const cfg = await getTenantConfig(companyId);

  if (event.httpMethod === "GET") {
    return json(200, {
      configured: !!cfg.whopApiKey,
      whopCompanyId: cfg.whopCompanyId || null,
      isPaid: await isPaidTier(companyId),
      branding: cfg.branding,
      points: cfg.points,
      fx: cfg.fx,
      checkinRewards: cfg.checkinRewards,
      seasonTopRewards: cfg.seasonTopRewards,
      rewards: cfg.rewards,
      redeemCodes: cfg.redeemCodes,
      codesEnabled: cfg.codesEnabled,
      unlockAllFeatures: cfg.unlockAllFeatures,
      chestRules: cfg.chestRules,
      events: cfg.events,
      eventsEnabled: cfg.eventsEnabled,
      milestoneRules: cfg.milestoneRules,
    });
  }

  if (event.httpMethod !== "POST") return json(405, { error: "GET or POST" });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}
  const { whopApiKey, whopCompanyId } = body;

  // whopApiKey/whopCompanyId: chỉ validate + áp dụng NẾU có gửi field đó
  // trong request này (để các lần lưu CMS khác — vd chỉ sửa rewards — không
  // bị bắt phải gửi lại API key).
  if (whopApiKey !== undefined && !String(whopApiKey).trim()) {
    return json(400, { error: "Company API key cannot be empty." });
  }
  if (whopCompanyId !== undefined && !String(whopCompanyId).trim()) {
    return json(400, { error: "Company ID cannot be empty." });
  }

  const partial = {};
  for (const k of ALLOWED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, k)) partial[k] = body[k];
  }
  // Light shape validation — avoids saving the wrong type and breaking the member-facing pages.
  for (const k of ["checkinRewards", "seasonTopRewards", "rewards", "events"]) {
    if (k in partial && !Array.isArray(partial[k])) {
      return json(400, { error: `${k} must be an array.` });
    }
  }
  if ("redeemCodes" in partial && (typeof partial.redeemCodes !== "object" || partial.redeemCodes === null || Array.isArray(partial.redeemCodes))) {
    return json(400, { error: "redeemCodes must be an object of { code: xu amount }." });
  }
  if ("chestRules" in partial && (typeof partial.chestRules !== "object" || partial.chestRules === null || Array.isArray(partial.chestRules))) {
    return json(400, { error: "chestRules must be an object." });
  }
  if ("milestoneRules" in partial && (typeof partial.milestoneRules !== "object" || partial.milestoneRules === null || Array.isArray(partial.milestoneRules))) {
    return json(400, { error: "milestoneRules must be an object." });
  }

  // Chặn bypass cap Free/Paid bằng cách gọi API thẳng (UI admin.html đã tự
  // chặn nhưng không tin client) — Free: 2 events / 2 rewards, Paid: 10 / 10.
  const paid = await isPaidTier(companyId);
  const limit = paid ? 10 : 2;
  if ("events" in partial && partial.events.length > limit) {
    return json(400, { error: `Free plan allows up to ${limit} events. Upgrade to Paid for more.` });
  }
  if ("rewards" in partial && partial.rewards.length > limit) {
    return json(400, { error: `Free plan allows up to ${limit} rewards. Upgrade to Paid for more.` });
  }
  // branding.logoUrl ẩn badge "Powered by GTVăn" — admin.html disable input
  // này khi free, nhưng vẫn gửi nguyên branding cũ trong mọi lần Save all, nên
  // chặn ở đây là chống gọi API thẳng để bypass, KHÔNG phải chặn save thường.
  if ("branding" in partial && !paid) {
    partial.branding = { ...partial.branding, logoUrl: cfg.branding.logoUrl || null };
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

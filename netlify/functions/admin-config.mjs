import { getAuthContext, lastVerifyError, lastAdminCheckError } from "./_auth.mjs";
import { getTenantConfig, saveTenantConfig, isPaidTier, getTierLevel, linkExperienceToTenant } from "./_tenant.mjs";
import { getCompanyAccessToken, getRealCompanyId } from "./_tokens.mjs";

// ĐÃ ĐỔI: không còn admin tự dán Company API key/Company ID nữa (xem
// _tokens.mjs — dùng 1 App API key chung, company nào cài app + bấm Approve
// đều dùng được ngay). Lần đầu admin mở trang Settings, tự gọi 1 lần API
// Whop để tìm các Experience (exp_xxx) thuộc company đó đang dùng CHÍNH app
// này, lưu bảng tra "tenant-by-experience" — để trang member (Experience
// View, chỉ nhận được experienceId, không có companyId) tìm đúng tenant.
// Đánh dấu đã link rồi (`experienceLinkedAt`) để không gọi lại API Whop mỗi
// lần admin mở trang — chỉ gọi lại nếu user bấm nút "Re-sync" (chưa có, có
// thể thêm sau nếu cần). Không chặn/làm fail GET nếu bước này lỗi.
// TẠM THỜI trả thêm diagnostic (status/body/url) để debug — xoá phần trả
// diagnostic sau khi xác định xong nguyên nhân không link được experience.
async function autoLinkExperiences(tenantId, realCompanyId) {
  const appId = process.env.WHOP_APP_ID || process.env.NEXT_PUBLIC_WHOP_APP_ID;
  if (!realCompanyId || !appId) return { skipped: true, realCompanyId, appId };
  const url = `https://api.whop.com/api/v1/experiences?company_id=${encodeURIComponent(realCompanyId)}&app_id=${encodeURIComponent(appId)}`;
  try {
    const apiKey = await getCompanyAccessToken(tenantId);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    const bodyText = await r.text();
    if (!r.ok) return { ok: false, status: r.status, url, body: bodyText.slice(0, 500) };
    let j = {};
    try { j = JSON.parse(bodyText); } catch (_) {}
    const list = j.data || j.experiences || [];
    for (const exp of list) {
      if (exp?.id) await linkExperienceToTenant(exp.id, tenantId);
    }
    await saveTenantConfig(tenantId, { experienceLinkedAt: new Date().toISOString() });
    return { ok: true, status: r.status, url, linkedCount: list.length, ids: list.map(e=>e.id) };
  } catch (e) {
    return { ok: false, error: e.message, url };
  }
}

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
  "seasonVipTopRewards",
  "seasonRefTopRewards",
  "rewards",
  "redeemCodes",
  "codesEnabled",
  "chestRules",
  "events",
  "eventsEnabled",
  "dailyEnabled",
  "storeEnabled",
  "mailboxEnabled",
  "milestoneRules",
  "onboardingCompleted",
  "digestEnabled",
  "digestEmail",
  "dailyDeal",
  "puzzlePieces",
  "lockedVideos",
  "videoSettings",
  "checkinMilestoneBonus",
  "checkinMilestoneDays",
];

// GET: trả toàn bộ config tenant (trừ whopApiKey/setupSecret — không bao giờ
// lộ ra ngoài) để trang Settings/CMS render đủ các section.
// POST: nhận { whopApiKey?, whopCompanyId?, ...bất kỳ field nào trong
// ALLOWED_KEYS }, merge từng phần đã gửi (mảng bị thay nguyên cục theo
// deepMerge của _tenant.mjs — caller phải tự gửi cả mảng đầy đủ).
export const handler = async (event) => {
  if (event.queryStringParameters && event.queryStringParameters.debug) {
    return json(403, { error: "Debug endpoint disabled." });
  }

  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Could not identify the user." });
  if (!companyId) return json(400, { error: "Could not identify the community. Please open this page inside Whop." });

  try {
    const cfg = await getTenantConfig(companyId);

    if (event.httpMethod === "GET") {
      if (!cfg.experienceLinkedAt) {
        // Netlify Functions không đảm bảo code chạy tiếp sau khi response trả
        // về (không có "background task" như edge runtime) — phải await ở đây,
        // chỉ xảy ra 1 lần (lần đầu) nên chấp nhận load chậm hơn 1 chút.
        await autoLinkExperiences(companyId, await getRealCompanyId(companyId));
      }
      const tierLevel = await getTierLevel(companyId);
      const tierNames = ["free", "growth", "pro", "agency"];
      return json(200, {
        configured: true,
        whopCompanyId: await getRealCompanyId(companyId),
        isPaid: tierLevel > 0 || !!cfg.unlockAllFeatures,
        currentTier: cfg.unlockAllFeatures ? "pro" : (tierNames[tierLevel] || "free"),
        tierLevel: cfg.unlockAllFeatures ? 2 : tierLevel,
        branding: cfg.branding,
        points: cfg.points,
        fx: cfg.fx,
        checkinRewards: cfg.checkinRewards,
        seasonVipTopRewards: cfg.seasonVipTopRewards,
        seasonRefTopRewards: cfg.seasonRefTopRewards,
        rewards: cfg.rewards,
        redeemCodes: cfg.redeemCodes,
        codesEnabled: cfg.codesEnabled,
        unlockAllFeatures: cfg.unlockAllFeatures,
        chestRules: cfg.chestRules,
        events: cfg.events,
        eventsEnabled: cfg.eventsEnabled,
        dailyEnabled: cfg.dailyEnabled !== false,
        storeEnabled: cfg.storeEnabled !== false,
        mailboxEnabled: cfg.mailboxEnabled !== false,
        milestoneRules: cfg.milestoneRules,
        onboardingCompleted: !!cfg.onboardingCompleted,
        digestEnabled: !!cfg.digestEnabled,
        digestEmail: cfg.digestEmail || "",
        dailyDeal: cfg.dailyDeal || null,
        checkinMilestoneDays: cfg.checkinMilestoneDays || null,
        puzzlePieces: cfg.puzzlePieces || [],
        lockedVideos: cfg.lockedVideos || [],
        videoSettings: cfg.videoSettings || { enabled: true, xuPerPiece: 0 },
      });
    }

    if (event.httpMethod !== "POST") return json(405, { error: "GET or POST" });

    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch (_) {}

    const partial = {};
    for (const k of ALLOWED_KEYS) {
      if (Object.prototype.hasOwnProperty.call(body, k)) partial[k] = body[k];
    }
    // Light shape validation — avoids saving the wrong type and breaking the member-facing pages.
    for (const k of ["checkinRewards", "seasonVipTopRewards", "seasonRefTopRewards", "rewards", "events"]) {
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
    // Validate nội dung rewards — chặn payload có kind lạ hoặc cost âm
    if (Array.isArray(partial.rewards)) {
      for (const r of partial.rewards) {
        if (typeof r !== "object" || r === null) continue;
        if (r.cost !== undefined && (typeof r.cost !== "number" || r.cost < 0 || !isFinite(r.cost))) {
          return json(400, { error: "Reward cost must be a non-negative number." });
        }
        if (r.payload && typeof r.payload === "object") {
          const { kind } = r.payload;
          if (kind && !["code", "link", "ea", "lucky-box"].includes(kind)) {
            return json(400, { error: `Invalid reward payload kind: ${kind}` });
          }
        }
      }
    }

    // Giới hạn theo tier (server-side, không tin client):
    // Free: 3 events / 2 rewards | Growth: 10/10 | Pro: 20/20 | Agency: không giới hạn
    const tierLevel = await getTierLevel(companyId);
    const eventsLimitArr  = [3, 10, 9999, 9999];
    const rewardsLimitArr = [3, 10, 9999, 9999];
    const eventsLimit  = cfg.unlockAllFeatures ? 9999 : (eventsLimitArr[tierLevel]  ?? 3);
    const rewardsLimit = cfg.unlockAllFeatures ? 9999 : (rewardsLimitArr[tierLevel] ?? 2);
    const paid = tierLevel > 0 || !!cfg.unlockAllFeatures;
    if ("events" in partial && partial.events.length > eventsLimit) {
      return json(400, { error: `Your plan allows up to ${eventsLimit} events. Upgrade for more.` });
    }
    if ("rewards" in partial && partial.rewards.length > rewardsLimit) {
      return json(400, { error: `Your plan allows up to ${rewardsLimit} rewards. Upgrade for more.` });
    }
    const milestoneLimitArr = [4, 10, 9999, 9999];
    const msLimit = cfg.unlockAllFeatures ? 9999 : (milestoneLimitArr[tierLevel] ?? 4);
    if ("milestoneRules" in partial && (partial.milestoneRules?.tiers || []).length > msLimit) {
      return json(400, { error: `Your plan allows up to ${msLimit} milestones. Upgrade for more.` });
    }
    if ("branding" in partial && !paid) {
      partial.branding = { ...partial.branding, logoUrl: cfg.branding.logoUrl || null };
    }

    await saveTenantConfig(companyId, partial);

    return json(200, {
      ok: true,
      configured: true,
    });
  } catch (e) {
    return json(500, { error: e.message || "Could not load or save settings." });
  }
};

import { pointsStore, tenantKey, casUpdate } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getTenantConfig } from "./_tenant.mjs";
import { getCompanyAccessToken } from "./_tokens.mjs";
import { computeEarned } from "./_points.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

function summarize(payload) {
  if (!payload) return "";
  if (payload.kind === "code") return payload.code || "";
  if (payload.kind === "ea")   return payload.label || "EA trial";
  if (payload.kind === "link") return payload.url || "";
  return "";
}

function gdriveImg(url){if(!url)return url;const m=url.match(/\/file\/d\/([^/?#]+)/);return m?'https://drive.google.com/thumbnail?id='+m[1]+'&sz=w800':url;}

class AlreadyClaimedError extends Error {}

// Mốc theo SỐ LƯỢT GIỚI THIỆU (referral) — dùng đúng số `referrals` đã tính ở
// computeEarned() (giống Leaderboard/Store, không định nghĩa lại referral khác
// đi). Đây là số LIFETIME (không reset theo kỳ như USD nạp trước đây), nên chỉ
// cần lưu lại tier nào đã claim — không còn periodStart/usd.
async function loadClaimed(store, tenantId, userId) {
  const key = tenantKey("milestone-claimed", tenantId, userId);
  let claimedTiers = [];
  try {
    const v = await store.get(key, { type: "json" });
    if (Array.isArray(v)) claimedTiers = v;
  } catch (_) {}
  return { key, claimedTiers };
}

export const handler = async (event) => {
  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Could not identify the user." });
  if (!companyId) return json(400, { error: "Could not identify the community (companyId)." });

  const cfg = await getTenantConfig(companyId);
  const rules = cfg.milestoneRules || { enabled: false, tiers: [] };
  const store = pointsStore();
  const apiKey = await getCompanyAccessToken(companyId);
  const { earned: _earned, referrals } = await computeEarned(userId, apiKey, companyId, cfg);
  const { key: claimedKey, claimedTiers } = await loadClaimed(store, companyId, userId);

  if (event.httpMethod === "GET") {
    const tiers = (rules.tiers || []).map((t, i) => {
      const isSpin = t.rewardId === "__spin__";
      const isCustomItem = !!t.customItem && !isSpin;
      const reward = !isCustomItem && t.rewardId && !isSpin ? cfg.rewards.find((r) => r.id === t.rewardId) : null;
      return {
        thresholdReferrals: t.thresholdReferrals,
        label: isCustomItem ? (t.customItem.name || t.label) : (reward ? reward.name : t.label),
        icon: (isCustomItem || reward) ? "🎁" : (isSpin ? "🎰" : t.icon),
        xu: (!isCustomItem && !reward && !isSpin) ? t.xu : null,
        spinTickets: isSpin ? (t.spinTickets || 1) : null,
        image: isCustomItem ? (gdriveImg(t.customItem.image) || null) : (reward ? (reward.image || null) : null),
        boxStyle: isCustomItem ? (t.customItem.boxStyle || null) : null,
        unlocked: referrals >= t.thresholdReferrals,
        claimed: claimedTiers.includes(i),
      };
    });
    return json(200, {
      enabled: !!rules.enabled,
      referrals,
      tiers,
      branding: cfg.branding,
    });
  }

  if (event.httpMethod !== "POST") return json(405, { error: "GET or POST" });
  if (!rules.enabled) return json(400, { error: "This feature is not enabled." });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}
  const tierIndex = Number(body.tierIndex);
  const tier = (rules.tiers || [])[tierIndex];
  if (!tier) return json(400, { error: "Invalid milestone." });
  if (referrals < tier.thresholdReferrals) return json(402, { error: "You haven't reached this milestone yet." });

  // Khoá claim bằng casUpdate (không phải check rồi push thường) — chống 2
  // request claim CÙNG 1 tier song song đều pass kiểm tra "chưa claim" và đều
  // được phát quà 2 lần. Toàn bộ phần phát quà sau đó cũng bọc cùng 1
  // try/catch — lỗi tạm thời không được làm function crash với response
  // không phải JSON (client gọi r.json() sẽ lỗi parse nếu để lọt).
  try {
    await casUpdate(store, claimedKey, (current) => {
      const list = Array.isArray(current) ? current : [];
      if (list.includes(tierIndex)) throw new AlreadyClaimedError();
      return [...list, tierIndex];
    });

    let resultPayload = null;
    let resultCode = "";
    let xuGranted = 0;
    let ticketsGranted = 0;

    if (tier.rewardId === "__spin__") {
      ticketsGranted = tier.spinTickets || 1;
      await casUpdate(store, tenantKey("spin-tickets", companyId, userId), (current) => {
        return String((Number(current) || 0) + ticketsGranted);
      }, { type: "text" });
    } else if (tier.customItem) {
      resultCode = tier.customItem.name || "Item reward";
    } else if (tier.rewardId) {
      const reward = cfg.rewards.find((r) => r.id === tier.rewardId);
      if (reward) {
        resultPayload = reward.payload || { kind: "code", code: "" };
        resultCode = summarize(resultPayload);
        let history = [];
        try {
          const h = await store.get(tenantKey("history", companyId, userId), { type: "json" });
          if (Array.isArray(h)) history = h;
        } catch (_) {}
        history.unshift({
          at: new Date().toISOString(),
          rewardId: reward.id,
          reward: reward.name,
          cost: 0,
          code: resultCode,
        });
        await store.setJSON(tenantKey("history", companyId, userId), history);
      }
    } else {
      xuGranted = tier.xu || 0;
      await casUpdate(store, tenantKey("bonus", companyId, userId), (current) => {
        return String((Number(current) || 0) + xuGranted);
      }, { type: "text" });
    }

    return json(200, {
      ok: true,
      xu: xuGranted || null,
      tickets: ticketsGranted || null,
      payload: resultPayload,
      code: resultCode || null,
    });
  } catch (e) {
    if (e instanceof AlreadyClaimedError) return json(409, { error: "This milestone has already been claimed." });
    return json(500, { error: e.message || "Could not claim this milestone." });
  }
};

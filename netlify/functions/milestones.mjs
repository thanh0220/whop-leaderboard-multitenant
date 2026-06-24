import { pointsStore, tenantKey } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getTenantConfig } from "./_tenant.mjs";

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

// Tiến độ lưu theo blob `milestone-progress:<tenantId>:<userId>` — được CỘNG
// DỒN bởi webhook.mjs mỗi khi buyer đó có thanh toán thật. Function này chỉ
// đọc (GET) và xử lý claim (POST), KHÔNG tự cộng usd ở đây.
async function loadProgress(store, tenantId, userId, periodDays) {
  const key = tenantKey("milestone-progress", tenantId, userId);
  const periodMs = (periodDays || 7) * 86400000;
  const now = Date.now();
  let progress = null;
  try { progress = await store.get(key, { type: "json" }); } catch (_) {}
  if (!progress || now - progress.periodStart >= periodMs) {
    progress = { periodStart: now, usd: 0, claimedTiers: [] };
  }
  return { key, progress };
}

export const handler = async (event) => {
  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Could not identify the user." });
  if (!companyId) return json(400, { error: "Could not identify the community (companyId)." });

  const cfg = await getTenantConfig(companyId);
  const rules = cfg.milestoneRules || { enabled: false, periodDays: 7, tiers: [] };
  const store = pointsStore();
  const { progress } = await loadProgress(store, companyId, userId, rules.periodDays);

  if (event.httpMethod === "GET") {
    const tiers = (rules.tiers || []).map((t, i) => {
      const reward = t.rewardId ? cfg.rewards.find((r) => r.id === t.rewardId) : null;
      return {
        thresholdUsd: t.thresholdUsd,
        label: reward ? reward.name : t.label,
        icon: reward ? "🎁" : t.icon,
        xu: reward ? null : t.xu,
        image: reward ? (reward.image || null) : null,
        unlocked: progress.usd >= t.thresholdUsd,
        claimed: progress.claimedTiers.includes(i),
      };
    });
    return json(200, {
      enabled: !!rules.enabled,
      periodDays: rules.periodDays || 7,
      periodStart: progress.periodStart,
      periodEnd: progress.periodStart + (rules.periodDays || 7) * 86400000,
      usd: progress.usd,
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
  if (progress.usd < tier.thresholdUsd) return json(402, { error: "You haven't reached this milestone yet." });
  if (progress.claimedTiers.includes(tierIndex)) return json(409, { error: "This milestone has already been claimed." });

  const key = tenantKey("milestone-progress", companyId, userId);
  let resultPayload = null;
  let resultCode = "";
  let xuGranted = 0;

  if (tier.rewardId) {
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
  }
  if (!resultPayload) {
    xuGranted = tier.xu || 0;
    let bonus = 0;
    try { const b = await store.get(tenantKey("bonus", companyId, userId)); if (b) bonus = Number(b) || 0; } catch (_) {}
    bonus += xuGranted;
    await store.set(tenantKey("bonus", companyId, userId), String(bonus));
  }

  progress.claimedTiers.push(tierIndex);
  await store.setJSON(key, progress);

  return json(200, { ok: true, xu: xuGranted || null, payload: resultPayload, code: resultCode || null });
};

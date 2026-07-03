import { pointsStore, tenantKey, casUpdate, InsufficientFundsError, claimLock, ClaimLockedError } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getCompanyAccessToken } from "./_tokens.mjs";
import { computeEarned } from "./_points.mjs";
import { getTenantConfig } from "./_tenant.mjs";
import { utcDayKey } from "./_season.mjs";

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

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Could not identify the user." });
  if (!companyId) return json(400, { error: "Could not identify the community (companyId)." });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}

  try {
    const cfg = await getTenantConfig(companyId);
    const reward = cfg.rewards.find((r) => r.id === body.rewardId);
    if (!reward) return json(400, { error: "Invalid reward." });

    const apiKey = await getCompanyAccessToken(companyId);
    const { earned, paidUsd } = await computeEarned(userId, apiKey, companyId, cfg);

    // VIP-only check
    if (reward.vipOnly && !(paidUsd > 0)) {
      return json(403, { error: "This reward is for VIP (paid) members only." });
    }

    const store = pointsStore();
    try {
      await claimLock(store, `redeem:${companyId}:${userId}:${body.rewardId}`);
    } catch (e) {
      if (e instanceof ClaimLockedError) return json(409, { error: "Redeem already in progress. Please wait a moment." });
    }

    // Daily deal price override
    const dailyDeal = cfg.dailyDeal;
    let effectiveCost = reward.cost;
    let isDeal = false;
    if (dailyDeal?.rewardId === body.rewardId && (dailyDeal.discountPct || 0) > 0) {
      const today = utcDayKey();
      const lastBought = await store.get(tenantKey("deal-bought", companyId, userId)).catch(() => null);
      if (lastBought === today) {
        return json(409, { error: "You've already purchased today's deal. Come back tomorrow!" });
      }
      effectiveCost = Math.max(1, Math.round(reward.cost * (1 - dailyDeal.discountPct / 100)));
      isDeal = true;
    }

    // Stock check + decrement
    if (reward.stock != null) {
      const stockKey = tenantKey("stock", companyId, body.rewardId);
      let soldOut = false;
      try {
        await casUpdate(store, stockKey, (current) => {
          const remaining = current !== null ? Number(current) : reward.stock;
          if (remaining <= 0) { soldOut = true; throw new Error("SOLD_OUT"); }
          return String(remaining - 1);
        }, { type: "text" });
      } catch (e) {
        if (soldOut || e.message === "SOLD_OUT") return json(402, { error: "This item is sold out." });
        throw e;
      }
    }

    // Deduct XU
    let newSpent;
    try {
      newSpent = Number(await casUpdate(store, tenantKey("spent", companyId, userId), (current) => {
        const spent = Number(current) || 0;
        const available = earned - spent;
        if (available < effectiveCost) throw new InsufficientFundsError({ available, cost: effectiveCost });
        return String(spent + effectiveCost);
      }, { type: "text" }));
    } catch (e) {
      if (e instanceof InsufficientFundsError) {
        return json(402, { error: "Not enough points.", available: e.available, cost: e.cost });
      }
      throw e;
    }

    // Mark deal as bought today
    if (isDeal) {
      await store.set(tenantKey("deal-bought", companyId, userId), utcDayKey()).catch(() => {});
    }

    // Resolve lucky box → random prize
    let payload = reward.payload || { kind: "code", code: "" };
    let finalRewardName = reward.name;
    if (payload.kind === "lucky-box") {
      const pool = payload.pool || [];
      const total = pool.reduce((s, item) => s + (item.weight || 1), 0);
      let rand = Math.random() * total;
      let selected = pool[pool.length - 1] || { xu: 50, label: "XU Bonus" };
      for (const item of pool) {
        rand -= (item.weight || 1);
        if (rand <= 0) { selected = item; break; }
      }
      if (selected.xu) {
        await casUpdate(store, tenantKey("bonus", companyId, userId), (current) => {
          return String((Number(current) || 0) + selected.xu);
        }, { type: "text" });
        payload = { kind: "xu-prize", amount: selected.xu, label: selected.label || `+${selected.xu} XU` };
        finalRewardName = selected.label || `+${selected.xu} XU`;
      }
    }

    const codeSummary = summarize(payload);

    let history = [];
    try {
      const h = await store.get(tenantKey("history", companyId, userId), { type: "json" });
      if (Array.isArray(h)) history = h;
    } catch (_) {}
    history.unshift({
      at: new Date().toISOString(),
      rewardId: reward.id,
      reward: finalRewardName,
      cost: effectiveCost,
      code: codeSummary,
    });
    await store.setJSON(tenantKey("history", companyId, userId), history);

    return json(200, {
      ok: true,
      reward: finalRewardName,
      code: codeSummary,
      payload,
      remaining: earned - newSpent,
      isDeal,
      discountedFrom: isDeal ? reward.cost : null,
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

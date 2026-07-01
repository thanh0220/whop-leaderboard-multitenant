import { pointsStore, tenantKey, casUpdate, InsufficientFundsError, claimLock, ClaimLockedError } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getCompanyAccessToken } from "./_tokens.mjs";
import { computeEarned } from "./_points.mjs";
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
    const { earned } = await computeEarned(userId, apiKey, companyId, cfg);

    const store = pointsStore();
    try {
      await claimLock(store, `redeem:${companyId}:${userId}:${body.rewardId}`);
    } catch (e) {
      if (e instanceof ClaimLockedError) return json(409, { error: "Redeem already in progress. Please wait a moment." });
    }
    const payload = reward.payload || { kind: "code", code: "" };
    const codeSummary = summarize(payload);

    let newSpent;
    try {
      newSpent = Number(await casUpdate(store, tenantKey("spent", companyId, userId), (current) => {
        const spent = Number(current) || 0;
        const available = earned - spent;
        if (available < reward.cost) throw new InsufficientFundsError({ available, cost: reward.cost });
        return String(spent + reward.cost);
      }, { type: "text" }));
    } catch (e) {
      if (e instanceof InsufficientFundsError) {
        return json(402, { error: "Not enough points.", available: e.available, cost: e.cost });
      }
      throw e;
    }

    let history = [];
    try {
      const h = await store.get(tenantKey("history", companyId, userId), { type: "json" });
      if (Array.isArray(h)) history = h;
    } catch (_) {}
    history.unshift({
      at: new Date().toISOString(),
      rewardId: reward.id,
      reward: reward.name,
      cost: reward.cost,
      code: codeSummary,
    });
    await store.setJSON(tenantKey("history", companyId, userId), history);

    return json(200, {
      ok: true,
      reward: reward.name,
      code: codeSummary,
      payload,
      remaining: earned - newSpent,
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

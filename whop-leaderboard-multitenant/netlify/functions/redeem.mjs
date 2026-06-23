import { pointsStore, tenantKey } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getCompanyAccessToken } from "./_tokens.mjs";
import { computeEarned } from "./_points.mjs";
import { getTenantConfig, isPaidTier } from "./_tenant.mjs";

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
  if (!userId) return json(401, { error: "Không xác định được người dùng." });
  if (!companyId) return json(400, { error: "Không xác định được community (companyId)." });

  if (!(await isPaidTier(companyId))) {
    return json(402, { error: "Đổi quà là tính năng trả phí. Nâng cấp để mở khoá." });
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}

  try {
    const cfg = await getTenantConfig(companyId);
    const reward = cfg.rewards.find((r) => r.id === body.rewardId);
    if (!reward) return json(400, { error: "Quà không hợp lệ." });

    const apiKey = await getCompanyAccessToken(companyId);
    const { earned } = await computeEarned(userId, apiKey, companyId, cfg);

    const store = pointsStore();
    let spent = 0;
    try { const s = await store.get(tenantKey("spent", companyId, userId)); if (s) spent = Number(s) || 0; } catch (_) {}

    const available = earned - spent;
    if (available < reward.cost) {
      return json(402, { error: "Không đủ điểm.", available, cost: reward.cost });
    }

    const payload = reward.payload || { kind: "code", code: "" };
    const codeSummary = summarize(payload);

    const newSpent = spent + reward.cost;
    await store.set(tenantKey("spent", companyId, userId), String(newSpent));

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

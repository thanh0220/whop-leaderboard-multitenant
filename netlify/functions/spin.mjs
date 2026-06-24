import { pointsStore, tenantKey } from "./_store.mjs";
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

function pickWeighted(prizes) {
  const total = prizes.reduce((s, p) => s + (Number(p.weight) || 0), 0);
  if (total <= 0) return prizes[0];
  let roll = Math.random() * total;
  for (const p of prizes) {
    roll -= Number(p.weight) || 0;
    if (roll <= 0) return p;
  }
  return prizes[prizes.length - 1];
}

async function getTickets(store, tenantId, userId) {
  let tickets = 0;
  try { const v = await store.get(tenantKey("spin-tickets", tenantId, userId)); if (v) tickets = Number(v) || 0; } catch (_) {}
  return tickets;
}

export const handler = async (event) => {
  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Could not identify the user." });
  if (!companyId) return json(400, { error: "Could not identify the community (companyId)." });

  const cfg = await getTenantConfig(companyId);
  const rules = cfg.spinRules || { enabled: false, ticketsPerPayment: 5, xuCostPerTicket: 500, prizes: [] };
  const store = pointsStore();

  if (event.httpMethod === "GET") {
    const tickets = await getTickets(store, companyId, userId);
    let xuAvailable = 0;
    try {
      const apiKey = await getCompanyAccessToken(companyId);
      const { earned } = await computeEarned(userId, apiKey, companyId, cfg);
      let spent = 0;
      try { const s = await store.get(tenantKey("spent", companyId, userId)); if (s) spent = Number(s) || 0; } catch (_) {}
      xuAvailable = earned - spent;
    } catch (_) {}

    const prizes = (rules.prizes || []).map((p) => {
      const reward = p.rewardId ? cfg.rewards.find((r) => r.id === p.rewardId) : null;
      return {
        id: p.id,
        label: reward ? reward.name : p.label,
        image: reward ? (reward.image || null) : null,
        xu: reward ? null : p.xu,
        weight: p.weight,
      };
    });

    return json(200, {
      enabled: !!rules.enabled,
      tickets,
      xuAvailable,
      xuCostPerTicket: rules.xuCostPerTicket || 0,
      prizes,
    });
  }

  if (event.httpMethod !== "POST") return json(405, { error: "GET or POST" });
  if (!rules.enabled) return json(400, { error: "This feature is not enabled." });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}

  if (body.action === "buy") {
    try {
      const apiKey = await getCompanyAccessToken(companyId);
      const { earned } = await computeEarned(userId, apiKey, companyId, cfg);
      let spent = 0;
      try { const s = await store.get(tenantKey("spent", companyId, userId)); if (s) spent = Number(s) || 0; } catch (_) {}
      const available = earned - spent;
      const cost = rules.xuCostPerTicket || 0;
      if (available < cost) return json(402, { error: "Not enough XU.", available, cost });

      const newSpent = spent + cost;
      await store.set(tenantKey("spent", companyId, userId), String(newSpent));

      const tickets = (await getTickets(store, companyId, userId)) + 1;
      await store.set(tenantKey("spin-tickets", companyId, userId), String(tickets));

      return json(200, { ok: true, tickets, xuAvailable: available - cost });
    } catch (err) {
      return json(500, { error: err.message });
    }
  }

  if (body.action === "spin") {
    const tickets = await getTickets(store, companyId, userId);
    if (tickets <= 0) return json(402, { error: "No tickets left." });
    if (!rules.prizes || !rules.prizes.length) return json(400, { error: "No prizes configured." });

    await store.set(tenantKey("spin-tickets", companyId, userId), String(tickets - 1));

    const prize = pickWeighted(rules.prizes);
    let resultPayload = null;
    let resultCode = "";
    let xuGranted = 0;

    if (prize.rewardId) {
      const reward = cfg.rewards.find((r) => r.id === prize.rewardId);
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
      xuGranted = prize.xu || 0;
      let bonus = 0;
      try { const b = await store.get(tenantKey("bonus", companyId, userId)); if (b) bonus = Number(b) || 0; } catch (_) {}
      bonus += xuGranted;
      await store.set(tenantKey("bonus", companyId, userId), String(bonus));
    }

    return json(200, {
      ok: true,
      prizeId: prize.id,
      label: prize.rewardId ? (cfg.rewards.find((r) => r.id === prize.rewardId)?.name || prize.label) : prize.label,
      xu: xuGranted || null,
      code: resultCode || null,
      ticketsLeft: tickets - 1,
    });
  }

  return json(400, { error: "Unknown action." });
};

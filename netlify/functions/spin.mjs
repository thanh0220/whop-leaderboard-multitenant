import { pointsStore, tenantKey, casUpdate, InsufficientFundsError } from "./_store.mjs";
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
      const cost = rules.xuCostPerTicket || 0;

      let available;
      try {
        await casUpdate(store, tenantKey("spent", companyId, userId), (current) => {
          const spent = Number(current) || 0;
          available = earned - spent;
          if (available < cost) throw new InsufficientFundsError({ available, cost });
          return String(spent + cost);
        }, { type: "text" });
      } catch (e) {
        if (e instanceof InsufficientFundsError) {
          return json(402, { error: "Not enough XU.", available: e.available, cost: e.cost });
        }
        throw e;
      }

      const tickets = await casUpdate(store, tenantKey("spin-tickets", companyId, userId), (current) => {
        return String((Number(current) || 0) + 1);
      }, { type: "text" });

      return json(200, { ok: true, tickets: Number(tickets), xuAvailable: available - cost });
    } catch (err) {
      return json(500, { error: err.message });
    }
  }

  if (body.action === "spin") {
    if (!rules.prizes || !rules.prizes.length) return json(400, { error: "No prizes configured." });

    // Toàn bộ luồng quay (trừ vé, chọn giải, ghi lịch sử/cộng xu) bọc trong 1
    // try/catch DUY NHẤT — lỗi tạm thời ở bất kỳ bước nào không được làm
    // function crash với response không phải JSON (client gọi r.json() sẽ lỗi
    // parse nếu để lọt).
    try {
      await casUpdate(store, tenantKey("spin-tickets", companyId, userId), (current) => {
        const tickets = Number(current) || 0;
        if (tickets <= 0) throw new InsufficientFundsError({ available: 0, cost: 1 });
        return String(tickets - 1);
      }, { type: "text" });

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
        await casUpdate(store, tenantKey("bonus", companyId, userId), (current) => {
          return String((Number(current) || 0) + xuGranted);
        }, { type: "text" });
      }

      const ticketsLeft = Number((await store.get(tenantKey("spin-tickets", companyId, userId))) || 0);
      return json(200, {
        ok: true,
        prizeId: prize.id,
        label: prize.rewardId ? (cfg.rewards.find((r) => r.id === prize.rewardId)?.name || prize.label) : prize.label,
        xu: xuGranted || null,
        code: resultCode || null,
        ticketsLeft,
      });
    } catch (e) {
      if (e instanceof InsufficientFundsError) return json(402, { error: "No tickets left." });
      return json(500, { error: e.message || "Could not process spin." });
    }
  }

  return json(400, { error: "Unknown action." });
};

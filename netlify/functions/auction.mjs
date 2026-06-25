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

class AuctionClosedError extends Error {}
class BidTooLowError extends Error {
  constructor(minNext) { super("bid-too-low"); this.minNext = minNext; }
}

function pickUsername(u) {
  if (!u || typeof u !== "object") return null;
  return u.username || u.name || (u.email ? String(u.email).split("@")[0] : null) || null;
}

async function fetchUserName(userId, apiKey) {
  if (!apiKey) return userId;
  try {
    const r = await fetch(`https://api.whop.com/api/v1/users/${userId}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (r.ok) { const u = await r.json(); return pickUsername(u) || userId; }
  } catch (_) {}
  return userId;
}

async function availableXu(store, companyId, userId, apiKey, cfg) {
  const { earned } = await computeEarned(userId, apiKey, companyId, cfg);
  let spent = 0;
  try { const s = await store.get(tenantKey("spent", companyId, userId)); if (s) spent = Number(s) || 0; } catch (_) {}
  return { available: earned - spent, spent };
}

// Tự "chốt" phiên đấu giá đã hết giờ ngay trong request — dự án này KHÔNG có
// cron/scheduled function, nên phải chốt lazy lúc có ai GET/bid sau endsAt.
async function settleIfNeeded(store, tenantId, state, cfg) {
  if (!state || state.settled || Date.now() < state.endsAt) return state;

  // Duyệt các mức bid cao nhất → thấp dần (loại trùng userId, giữ bid cao nhất
  // của mỗi người), thử trừ xu người đầu tiên còn đủ — không đủ thì rớt tiếp.
  // Trừ XU bằng casUpdate (không phải get-rồi-set thường) để tránh trừ XU 2
  // lần nếu lỡ có 2 request cùng settle phiên đấu giá gần đồng thời.
  const seen = new Set();
  const candidates = [...state.bids]
    .sort((a, b) => b.amount - a.amount)
    .filter((b) => { if (seen.has(b.userId)) return false; seen.add(b.userId); return true; });

  let winner = null;
  for (const c of candidates) {
    try {
      const apiKey = await getCompanyAccessToken(tenantId);
      const { earned } = await computeEarned(c.userId, apiKey, tenantId, cfg);
      await casUpdate(store, tenantKey("spent", tenantId, c.userId), (current) => {
        const curSpent = Number(current) || 0;
        const available = earned - curSpent;
        if (available < c.amount) throw new InsufficientFundsError({ available, cost: c.amount });
        return String(curSpent + c.amount);
      }, { type: "text" });
      winner = c;
      break;
    } catch (_) {
      // Không đủ XU (hoặc lỗi tạm thời) — thử người đặt giá cao kế tiếp.
    }
  }

  if (winner && cfg.auctionRules.rewardId) {
    const reward = cfg.rewards.find((r) => r.id === cfg.auctionRules.rewardId);
    if (reward) {
      const payload = reward.payload || { kind: "code", code: "" };
      let history = [];
      try {
        const h = await store.get(tenantKey("history", tenantId, winner.userId), { type: "json" });
        if (Array.isArray(h)) history = h;
      } catch (_) {}
      history.unshift({
        at: new Date().toISOString(),
        rewardId: reward.id,
        reward: reward.name,
        cost: winner.amount,
        code: summarize(payload),
      });
      await store.setJSON(tenantKey("history", tenantId, winner.userId), history);
    }
  }

  state.settled = true;
  state.winnerUserId = winner ? winner.userId : null;
  state.winnerName = winner ? winner.name : null;
  state.resultXu = winner ? winner.amount : null;
  await store.setJSON(tenantKey("auction-state", tenantId), state);
  return state;
}

export const handler = async (event) => {
  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Could not identify the user." });
  if (!companyId) return json(400, { error: "Could not identify the community (companyId)." });

  const cfg = await getTenantConfig(companyId);
  const rules = cfg.auctionRules || { enabled: false, rewardId: null, startingBid: 5000, minIncrement: 100, durationHours: 48 };
  const store = pointsStore();
  const stateKey = tenantKey("auction-state", companyId);

  let state = null;
  try { state = await store.get(stateKey, { type: "json" }); } catch (_) {}
  state = await settleIfNeeded(store, companyId, state, cfg);

  function publicView() {
    const reward = rules.rewardId ? cfg.rewards.find((r) => r.id === rules.rewardId) : null;
    const nextMin = state ? (state.highestBid > 0 ? state.highestBid + rules.minIncrement : rules.startingBid) : rules.startingBid;
    return {
      enabled: !!rules.enabled,
      item: reward ? { name: reward.name, image: reward.image || null, desc: reward.desc || "" } : null,
      startingBid: rules.startingBid,
      minIncrement: rules.minIncrement,
      active: !!(state && !state.settled),
      startedAt: state ? state.startedAt : null,
      endsAt: state ? state.endsAt : null,
      highestBid: state ? state.highestBid : 0,
      highestBidderName: state ? state.highestBidderName : null,
      isMeHighest: !!(state && state.highestBidderId === userId),
      nextMinBid: nextMin,
      bids: state ? state.bids.slice(0, 10) : [],
      settled: !!(state && state.settled),
      winnerName: state ? state.winnerName : null,
      isMeWinner: !!(state && state.winnerUserId === userId),
    };
  }

  if (event.httpMethod === "GET") return json(200, publicView());
  if (event.httpMethod !== "POST") return json(405, { error: "GET or POST" });
  if (!rules.enabled) return json(400, { error: "This feature is not enabled." });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}

  if (body.action === "start") {
    if (!rules.rewardId) return json(400, { error: "Pick a Reward Store item for the auction first." });
    const now = Date.now();
    state = {
      startedAt: now,
      endsAt: now + (rules.durationHours || 48) * 3600000,
      highestBid: 0,
      highestBidderId: null,
      highestBidderName: null,
      bids: [],
      settled: false,
      winnerUserId: null,
      winnerName: null,
      resultXu: null,
    };
    await store.setJSON(stateKey, state);
    return json(200, publicView());
  }

  if (body.action === "bid") {
    if (!state || state.settled) return json(400, { error: "There is no active auction right now." });
    if (Date.now() >= state.endsAt) return json(400, { error: "This auction has ended." });

    const amount = Number(body.amount);

    try {
      const apiKey = await getCompanyAccessToken(companyId);
      const { available } = await availableXu(store, companyId, userId, apiKey, cfg);
      const name = await fetchUserName(userId, apiKey);

      // Đọc lại auction-state NGAY trong khoá CAS (không dùng biến `state` đã
      // đọc ở trên, có thể đã cũ) — chống 2 bid song song ghi đè nhau làm mất
      // 1 bid (lost update) hoặc đặt giá thấp hơn mức tối thiểu thật lúc ghi.
      state = await casUpdate(store, stateKey, (current) => {
        if (!current || current.settled) throw new AuctionClosedError("There is no active auction right now.");
        if (Date.now() >= current.endsAt) throw new AuctionClosedError("This auction has ended.");
        const minNext = current.highestBid > 0 ? current.highestBid + rules.minIncrement : rules.startingBid;
        if (!amount || amount < minNext) throw new BidTooLowError(minNext);
        if (available < amount) throw new InsufficientFundsError({ available, cost: amount });
        const next = { ...current };
        next.bids = [{ userId, name, amount, at: new Date().toISOString() }, ...current.bids].slice(0, 50);
        next.highestBid = amount;
        next.highestBidderId = userId;
        next.highestBidderName = name;
        return next;
      }, { type: "json" });

      return json(200, publicView());
    } catch (e) {
      if (e instanceof InsufficientFundsError) return json(402, { error: "Not enough XU.", available: e.available });
      if (e instanceof BidTooLowError) return json(400, { error: `Bid must be at least ${e.minNext} XU.` });
      if (e instanceof AuctionClosedError) return json(400, { error: e.message });
      return json(500, { error: e.message });
    }
  }

  return json(400, { error: "Unknown action." });
};

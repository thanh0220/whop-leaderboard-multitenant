import { pointsStore, tenantKey } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getCompanyAccessToken } from "./_tokens.mjs";
import { computeEarned } from "./_points.mjs";
import { getTenantConfig, isPaidTier } from "./_tenant.mjs";
import { utcDayKey, seasonInfo } from "./_season.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

function yesterday(dayKey) {
  const d = new Date(dayKey + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export const handler = async (event) => {
  const h = event.headers || {};
  const debug = event.queryStringParameters && event.queryStringParameters.debug;

  if (debug) {
    const tokenHeader = h["x-whop-user-token"] || h["X-Whop-User-Token"];

    // Decode (KHÔNG verify chữ ký) phần payload của JWT để soi xem Whop có
    // nhúng companyId/experienceId ngay trong token không — đây là cách giải
    // quyết "query string rỗng" mà không cần đoán thêm.
    let tokenPayload = null;
    if (tokenHeader) {
      try {
        const parts = String(tokenHeader).split(".");
        if (parts[1]) {
          const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
          tokenPayload = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
        }
      } catch (_) {}
    }

    // Mọi header bắt đầu bằng x-whop hoặc liên quan host — đây là nơi khả
    // năng cao nhất Whop gắn companyId/experienceId khi query string trống.
    const relevantHeaders = {};
    Object.keys(h).forEach((k) => {
      const lk = k.toLowerCase();
      if (lk.startsWith("x-whop") || lk === "host" || lk === "x-forwarded-host" || lk === "referer" || lk === "origin") {
        relevantHeaders[k] = h[k];
      }
    });

    return json(200, {
      debug: true,
      headerNames: Object.keys(h),
      relevantHeaders,
      queryParams: event.queryStringParameters || {},
      hasTokenHeader: !!tokenHeader,
      tokenPayload,
      appIdSet: !!(process.env.NEXT_PUBLIC_WHOP_APP_ID || process.env.WHOP_APP_ID),
      appKeySet: !!process.env.WHOP_APP_API_KEY,
    });
  }

  const { userId, companyId } = await getAuthContext(event);
  if (!userId) {
    return json(401, { error: "Could not identify the user. Please open this page inside Whop." });
  }
  if (!companyId) {
    return json(400, { error: "Could not identify the community (companyId)." });
  }

  try {
    const cfg = await getTenantConfig(companyId);
    const apiKey = await getCompanyAccessToken(companyId);
    const { earned, paidUsd, referrals, months, bonus } = await computeEarned(userId, apiKey, companyId, cfg);

    const store = pointsStore();
    let spent = 0, history = [];
    try { const s = await store.get(tenantKey("spent", companyId, userId)); if (s) spent = Number(s) || 0; } catch (_) {}
    try { const h2 = await store.get(tenantKey("history", companyId, userId), { type: "json" }); if (Array.isArray(h2)) history = h2; } catch (_) {}

    // ---- daily check-in state ----
    const today = utcDayKey();
    let ck = { lastDay: null, streak: 0 };
    try {
      const s = await store.get(tenantKey("checkin", companyId, userId), { type: "json" });
      if (s && typeof s === "object") ck = { lastDay: s.lastDay || null, streak: Number(s.streak) || 0 };
    } catch (_) {}
    const checkinCanClaim = ck.lastDay !== today;
    const nextStreak = checkinCanClaim
      ? (ck.lastDay === yesterday(today) ? ck.streak + 1 : 1)
      : ck.streak;
    const nextReward = cfg.checkinRewards[((nextStreak - 1) % cfg.checkinRewards.length + cfg.checkinRewards.length) % cfg.checkinRewards.length];

    // username để chào
    let username = userId;
    try {
      const r = await fetch(`https://api.whop.com/api/v1/users/${userId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (r.ok) { const u = await r.json(); username = u.username || u.name || userId; }
    } catch (_) {}

    return json(200, {
      userId, username,
      tier: (await isPaidTier(companyId)) ? "paid" : "free",
      earned, spent, available: Math.max(0, earned - spent),
      paidUsd, referrals, months, bonus, history,
      rewards: cfg.rewards, points: cfg.points,
      checkin: { today, streak: ck.streak, canClaim: checkinCanClaim, nextStreak, nextReward, calendar: cfg.checkinRewards },
      season: { ...seasonInfo(), topRewards: cfg.seasonTopRewards },
      branding: cfg.branding,
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

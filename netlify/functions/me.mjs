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
    const store = pointsStore();

    // Các lệnh đọc Blobs dưới đây độc lập với nhau — chạy song song thay vì
    // tuần tự để giảm thời gian load trang.
    const [{ earned, paidUsd, referrals, months, bonus, username }, spentRaw, historyRaw, checkinRaw, paid] =
      await Promise.all([
        computeEarned(userId, apiKey, companyId, cfg),
        store.get(tenantKey("spent", companyId, userId)).catch(() => null),
        store.get(tenantKey("history", companyId, userId), { type: "json" }).catch(() => null),
        store.get(tenantKey("checkin", companyId, userId), { type: "json" }).catch(() => null),
        isPaidTier(companyId, cfg),
      ]);

    const spent = Number(spentRaw) || 0;
    const history = Array.isArray(historyRaw) ? historyRaw : [];

    // ---- daily check-in state ----
    const today = utcDayKey();
    let ck = { lastDay: null, streak: 0 };
    if (checkinRaw && typeof checkinRaw === "object") {
      ck = { lastDay: checkinRaw.lastDay || null, streak: Number(checkinRaw.streak) || 0 };
    }
    const checkinCanClaim = ck.lastDay !== today;
    const nextStreak = checkinCanClaim
      ? (ck.lastDay === yesterday(today) ? ck.streak + 1 : 1)
      : ck.streak;
    const nextReward = cfg.checkinRewards[((nextStreak - 1) % cfg.checkinRewards.length + cfg.checkinRewards.length) % cfg.checkinRewards.length];

    return json(200, {
      userId, username,
      tier: paid ? "paid" : "free",
      earned, spent, available: Math.max(0, earned - spent),
      paidUsd, referrals, months, bonus, history,
      // Free 2 / Paid 10 — chỉ ẩn phần dư khỏi member nếu tenant downgrade, không xoá data thật.
      rewards: paid ? cfg.rewards : cfg.rewards.slice(0, 2),
      points: cfg.points,
      checkin: { today, streak: ck.streak, canClaim: checkinCanClaim, nextStreak, nextReward, calendar: cfg.checkinRewards },
      season: { ...seasonInfo(), topRewards: cfg.seasonTopRewards },
      branding: cfg.branding,
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

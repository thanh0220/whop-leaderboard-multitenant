import { pointsStore, tenantKey } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getCompanyAccessToken, getRealCompanyId } from "./_tokens.mjs";
import { getTenantConfig } from "./_tenant.mjs";
import { utcDayKey } from "./_season.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

const CACHE_TTL_MS = 10 * 60 * 1000;

function subtractDays(dayKey, n) {
  const d = new Date(dayKey + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export const handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "GET only" });

  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Not authenticated." });
  if (!companyId) return json(400, { error: "No community found." });

  try {
    const store = pointsStore();
    const cacheKey = tenantKey("insights-cache", companyId);

    let cached = null;
    try { cached = await store.get(cacheKey, { type: "json" }); } catch (_) {}
    if (cached && cached.cachedAt && Date.now() - new Date(cached.cachedAt).getTime() < CACHE_TTL_MS) {
      return json(200, cached);
    }

    const cfg = await getTenantConfig(companyId);
    const apiKey = await getCompanyAccessToken(companyId);
    const realCompanyId = await getRealCompanyId(companyId, cfg);
    const today = utcDayKey();
    const cutoffAtRisk = subtractDays(today, 5);

    // List checkin blobs for this company (up to 500)
    const prefix = `checkin:${companyId}:`;
    let checkinKeys = [];
    try {
      const { blobs } = await store.list({ prefix });
      checkinKeys = (blobs || []).map((b) => b.key);
    } catch (_) {}

    const sampled = checkinKeys.slice(0, 500);
    const atRisk = [];
    const vip = [];

    for (const key of sampled) {
      try {
        const data = await store.get(key, { type: "json" });
        if (!data || typeof data !== "object") continue;
        const { lastDay, streak } = data;
        if (!streak || streak <= 0) continue;
        const memberId = key.slice(prefix.length);
        if (lastDay && lastDay <= cutoffAtRisk) {
          atRisk.push({ userId: memberId, streak, lastDay });
        }
        if (streak >= 14) {
          vip.push({ userId: memberId, streak, lastDay });
        }
      } catch (_) {}
    }

    atRisk.sort((a, b) => (b.lastDay || "") < (a.lastDay || "") ? -1 : 1);
    vip.sort((a, b) => b.streak - a.streak);

    // Fetch new joiners (members joined in last 7 days)
    let newJoiners = [];
    try {
      const r = await fetch(
        `https://api.whop.com/api/v1/memberships?company_id=${encodeURIComponent(realCompanyId)}&page=1&per_page=25&expand[]=user`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      if (r.ok) {
        const j = await r.json();
        const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
        newJoiners = (j.data || [])
          .filter((m) => {
            const t = m.created_at;
            const ms = typeof t === "number" ? (t < 1e12 ? t * 1000 : t) : Date.parse(t);
            return !isNaN(ms) && ms > sevenDaysAgo;
          })
          .slice(0, 10)
          .map((m) => {
            const u = m.user && typeof m.user === "object" ? m.user : null;
            return {
              userId: u ? u.id : (typeof m.user === "string" ? m.user : m.user_id || ""),
              username: u ? (u.username || u.name || u.id || "Member") : "Member",
            };
          })
          .filter((m) => m.userId);
      }
    } catch (_) {}

    const result = {
      atRisk: atRisk.slice(0, 20),
      vip: vip.slice(0, 20),
      newJoiners,
      totalScanned: sampled.length,
      cachedAt: new Date().toISOString(),
    };

    try { await store.setJSON(cacheKey, result); } catch (_) {}

    return json(200, result);
  } catch (err) {
    return json(500, { error: err.message });
  }
};

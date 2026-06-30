import { getAuthContext, isCompanyAdmin } from "./_auth.mjs";
import { getTenantConfig, getTierLevel } from "./_tenant.mjs";
import { getRealCompanyId, getCompanyAccessToken } from "./_tokens.mjs";
import { pointsStore, tenantKey } from "./_store.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

// Lấy member list từ Whop API (tối đa 3 trang = 300 members)
async function fetchMemberIds(apiKey, realCompanyId, cap) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const ACTIVE = ["active", "completed", "trialing", "past_due", "canceling"];
  let ids = [];
  for (let page = 1; page <= 3; page++) {
    const r = await fetch(
      `https://api.whop.com/api/v1/memberships?company_id=${realCompanyId}&page=${page}&per_page=100`,
      { headers }
    );
    if (!r.ok) break;
    const j = await r.json();
    const batch = (j.data || [])
      .filter((m) => m.valid === true || ACTIVE.includes(String(m.status || "").toLowerCase()))
      .map((m) => m.user_id || (typeof m.user === "string" ? m.user : m.user?.id) || null)
      .filter(Boolean);
    ids = ids.concat(batch);
    if (ids.length >= cap) break;
    const tp = j.pagination?.total_pages;
    if (!tp || page >= tp || batch.length === 0) break;
  }
  return [...new Set(ids)].slice(0, cap);
}

export const handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "GET only" });

  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Unauthorized" });
  if (!companyId) return json(400, { error: "Could not identify community." });

  const realCompanyId = await getRealCompanyId(companyId);
  if (!(await isCompanyAdmin(userId, realCompanyId))) {
    return json(403, { error: "Admin only." });
  }

  const store = pointsStore();
  const cacheKey = tenantKey("analytics-cache", companyId);
  const CACHE_TTL = 300_000; // 5 phút

  // Trả cache nếu còn mới
  try {
    const cached = await store.get(cacheKey, { type: "json" });
    if (cached?.cachedAt && Date.now() - new Date(cached.cachedAt).getTime() < CACHE_TTL) {
      return json(200, cached);
    }
  } catch (_) {}

  try {
    const cfg = await getTenantConfig(companyId);
    const tierLevel = await getTierLevel(companyId);
    const memberCap = cfg.unlockAllFeatures ? 500 : ([50, 500, 500, 500][tierLevel] ?? 50);

    const apiKey = await getCompanyAccessToken(companyId);
    const memberIds = await fetchMemberIds(apiKey, realCompanyId, memberCap);
    const totalMembers = memberIds.length;

    const today = new Date().toISOString().slice(0, 10);
    const d7  = new Date(Date.now() - 7  * 86400_000).toISOString().slice(0, 10);
    const d30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

    let checkInsToday = 0, checkInsWeek = 0, checkInsMonth = 0;
    let totalStreak = 0, streakCount = 0;

    // Đọc checkin blob cho từng member (parallel, max 50 concurrent)
    const BATCH = 50;
    for (let i = 0; i < memberIds.length; i += BATCH) {
      const slice = memberIds.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        slice.map((uid) => store.get(tenantKey("checkin", companyId, uid), { type: "json" }))
      );
      for (const r of results) {
        if (r.status !== "fulfilled" || !r.value) continue;
        const c = r.value;
        const last = c.lastDate || "";
        if (last === today) checkInsToday++;
        if (last >= d7)  checkInsWeek++;
        if (last >= d30) checkInsMonth++;
        if (c.streak > 0) { totalStreak += Number(c.streak) || 0; streakCount++; }
      }
    }

    const checkInRate7d  = totalMembers > 0 ? Math.round(checkInsWeek  / totalMembers * 100) : 0;
    const checkInRate30d = totalMembers > 0 ? Math.round(checkInsMonth / totalMembers * 100) : 0;
    const avgStreak = streakCount > 0 ? Math.round((totalStreak / streakCount) * 10) / 10 : 0;

    const result = {
      totalMembers,
      checkInsToday,
      checkInsWeek,
      checkInsMonth,
      checkInRate7d,
      checkInRate30d,
      avgStreak,
      tierLevel,
      cachedAt: new Date().toISOString(),
    };

    try { await store.setJSON(cacheKey, result); } catch (_) {}
    return json(200, result);
  } catch (err) {
    return json(500, { error: err.message });
  }
};

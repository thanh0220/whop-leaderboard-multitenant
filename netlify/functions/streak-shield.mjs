import { pointsStore, tenantKey, casUpdate, InsufficientFundsError } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getCompanyAccessToken } from "./_tokens.mjs";
import { computeEarned } from "./_points.mjs";
import { getTenantConfig } from "./_tenant.mjs";
import { utcDayKey } from "./_season.mjs";

const SHIELD_COST = 20;
const SHIELD_DAYS = 30;

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

function addDays(dayKey, n) {
  const d = new Date(dayKey + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const handler = async (event) => {
  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Could not identify the user." });
  if (!companyId) return json(400, { error: "Could not identify the community (companyId)." });

  const store = pointsStore();
  const today = utcDayKey();

  if (event.httpMethod === "GET") {
    try {
      const ck = await store.get(tenantKey("checkin", companyId, userId), { type: "json" }).catch(() => null);
      const expiry = ck && ck.shieldExpiresAt;
      return json(200, { shieldActive: !!(expiry && expiry >= today), shieldExpiresAt: expiry || null });
    } catch (e) {
      return json(500, { error: e.message });
    }
  }

  if (event.httpMethod !== "POST") return json(405, { error: "GET or POST" });

  try {
    const cfg = await getTenantConfig(companyId);
    const apiKey = await getCompanyAccessToken(companyId);
    const { earned } = await computeEarned(userId, apiKey, companyId, cfg);

    const ck = await store.get(tenantKey("checkin", companyId, userId), { type: "json" }).catch(() => null);
    const existingExpiry = ck && ck.shieldExpiresAt;
    if (existingExpiry && existingExpiry >= today) {
      return json(409, { error: "Shield is already active.", shieldExpiresAt: existingExpiry });
    }

    try {
      await casUpdate(store, tenantKey("spent", companyId, userId), (current) => {
        const spent = Number(current) || 0;
        const available = earned - spent;
        if (available < SHIELD_COST) throw new InsufficientFundsError({ available, cost: SHIELD_COST });
        return String(spent + SHIELD_COST);
      }, { type: "text" });
    } catch (e) {
      if (e instanceof InsufficientFundsError) {
        return json(402, { error: `Not enough XU. Need ${SHIELD_COST} XU.`, available: e.available });
      }
      throw e;
    }

    const shieldExpiresAt = addDays(today, SHIELD_DAYS);
    await casUpdate(store, tenantKey("checkin", companyId, userId), (current) => {
      const cur = (current && typeof current === "object") ? current : { lastDay: null, streak: 0 };
      return { ...cur, shieldExpiresAt };
    });

    return json(200, { ok: true, shieldActive: true, shieldExpiresAt, cost: SHIELD_COST });
  } catch (e) {
    return json(500, { error: e.message });
  }
};

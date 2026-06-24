import { pointsStore, tenantKey } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getTenantConfig, isPaidTier } from "./_tenant.mjs";
import { utcDayKey } from "./_season.mjs";
import { isWithinWindow } from "./_repeat.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Could not identify the user." });
  if (!companyId) return json(400, { error: "Could not identify the community (companyId)." });

  if (!(await isPaidTier(companyId))) {
    return json(402, { error: "Redeeming codes is a paid feature. Upgrade to unlock it." });
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}
  const code = String(body.code || "").trim().toLowerCase();
  if (!code) return json(400, { error: "Please enter a code." });

  const cfg = await getTenantConfig(companyId);
  const raw = cfg.redeemCodes[code];
  // Backward compatibility: old codes stored as a plain number (XU), new codes stored as an object { xu, startDate?, endDate? }.
  const reward = typeof raw === "number" ? { xu: raw } : raw;
  if (!reward || !reward.xu) return json(400, { error: "Invalid code." });

  const today = utcDayKey();
  if (!isWithinWindow(reward.startDate, reward.endDate, reward.repeatDays, today)) {
    return json(400, { error: "This code isn't active yet or has expired." });
  }

  const store = pointsStore();
  let bonus = 0;
  try { const b = await store.get(tenantKey("bonus", companyId, userId)); if (b) bonus = Number(b) || 0; } catch (_) {}
  bonus += reward.xu;
  await store.set(tenantKey("bonus", companyId, userId), String(bonus));

  return json(200, {
    ok: true,
    code,
    added: reward.xu,
    bonusTotal: bonus,
    message: `+${reward.xu} XU added!`,
  });
};

import { pointsStore, tenantKey } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getTenantConfig, isPaidTier } from "./_tenant.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

// State per user (blob key `mailbox:<companyId>:<userId>`): mảng entry rương
// do webhook.mjs phát mỗi khi có người mua hàng — xem webhook.mjs.

export const handler = async (event) => {
  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Could not identify the user." });
  if (!companyId) return json(400, { error: "Could not identify the community (companyId)." });

  const store = pointsStore();
  const key = tenantKey("mailbox", companyId, userId);
  const now = Date.now();

  let list = [];
  try {
    const s = await store.get(key, { type: "json" });
    if (Array.isArray(s)) list = s;
  } catch (_) {}
  // Lọc bỏ entry hết hạn CHƯA nhận (đã nhận thì giữ lại để xem lịch sử gần đây).
  list = list.filter((e) => e.claimed || new Date(e.expiresAt).getTime() > now);

  if (event.httpMethod === "GET") {
    const cfg = await getTenantConfig(companyId);
    return json(200, { entries: list, branding: cfg.branding, isPaid: await isPaidTier(companyId) });
  }

  if (event.httpMethod !== "POST") return json(405, { error: "GET or POST" });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}
  const entry = list.find((e) => e.id === body.entryId);
  if (!entry) return json(400, { error: "Invalid or expired chest." });
  if (entry.claimed) return json(409, { error: "This chest has already been claimed." });
  if (new Date(entry.expiresAt).getTime() <= now) return json(400, { error: "This chest has expired." });

  entry.claimed = true;
  await store.setJSON(key, list);

  let bonus = 0;
  try { const b = await store.get(tenantKey("bonus", companyId, userId)); if (b) bonus = Number(b) || 0; } catch (_) {}
  bonus += entry.xu;
  await store.set(tenantKey("bonus", companyId, userId), String(bonus));

  return json(200, { ok: true, xu: entry.xu, tier: entry.tier, bonusTotal: bonus, message: `+${entry.xu} XU from ${entry.label}!` });
};

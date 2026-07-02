import { pointsStore, tenantKey } from "./_store.mjs";

const WHOP_API_V5 = "https://api.whop.com/api/v5";

async function appendMailbox(store, tenantId, userId, entry) {
  const key = tenantKey("mailbox", tenantId, userId);
  const now = Date.now();
  let list = [];
  try {
    const s = await store.get(key, { type: "json" });
    if (Array.isArray(s)) list = s;
  } catch (_) {}
  list = list.filter((e) => !e.claimed || new Date(e.expiresAt || 0).getTime() > now - 14 * 86400000);
  list.unshift(entry);
  list = list.slice(0, 50);
  await store.setJSON(key, list);
}

export async function triggerPromoReward(userId, companyId, streakDays, discountPct, apiKey, realCompanyId) {
  const store = pointsStore();

  const givenKey = tenantKey("promo-given", companyId, userId);
  let given = {};
  try {
    const raw = await store.get(givenKey, { type: "json" });
    if (raw && typeof raw === "object") given = raw;
  } catch (_) {}

  if (given[String(streakDays)]) return;

  const code = `STREAK${streakDays}-${userId.slice(-8).toUpperCase()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString();

  let promoCreated = false;
  let finalCode = code;

  try {
    const r = await fetch(
      `${WHOP_API_V5}/promo_codes?company_id=${encodeURIComponent(realCompanyId)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          discount_type: "percent",
          discount_amount: discountPct,
          max_uses: 1,
        }),
      }
    );
    if (r.ok) {
      const j = await r.json();
      finalCode = j.code || code;
      promoCreated = true;
    } else {
      console.warn(`promo-reward: Whop API ${r.status} for ${realCompanyId} — permission not granted yet?`);
    }
  } catch (err) {
    console.warn("promo-reward: Whop API error:", err.message);
  }

  given[String(streakDays)] = { code: finalCode, grantedAt: now.toISOString(), promoCreated };
  try { await store.setJSON(givenKey, given); } catch (_) {}

  const entry = {
    id: `promo_${streakDays}_${userId}_${now.getTime()}`,
    type: "promo",
    tier: "promo",
    icon: "🏷️",
    label: `${streakDays}-Day Streak Reward`,
    promoCode: finalCode,
    discountPct,
    promoCreated,
    xu: 0,
    createdAt: now.toISOString(),
    expiresAt,
    claimed: true,
  };

  try { await appendMailbox(store, companyId, userId, entry); } catch (_) {}
}

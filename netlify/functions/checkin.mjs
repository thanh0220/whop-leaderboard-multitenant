import { pointsStore, tenantKey } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getTenantConfig, isPaidTier } from "./_tenant.mjs";
import { utcDayKey } from "./_season.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

// State per user (blob key `checkin:<companyId>:<userId>`):
//   { lastDay: "YYYY-MM-DD", streak: number }
// Bonus xu cộng vào blob `bonus:<companyId>:<userId>` (số nguyên dương).

function yesterday(dayKey) {
  const d = new Date(dayKey + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export const handler = async (event) => {
  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Could not identify the user." });
  if (!companyId) return json(400, { error: "Could not identify the community (companyId)." });

  const cfg = await getTenantConfig(companyId);
  const CHECKIN_REWARDS = cfg.checkinRewards;

  const store = pointsStore();
  const today = utcDayKey();
  let state = { lastDay: null, streak: 0 };
  try {
    const s = await store.get(tenantKey("checkin", companyId, userId), { type: "json" });
    if (s && typeof s === "object") state = { lastDay: s.lastDay || null, streak: Number(s.streak) || 0 };
  } catch (_) {}

  // GET: chỉ trả trạng thái (free tier vẫn xem được, chỉ claim mới bị khoá)
  if (event.httpMethod === "GET") {
    const canClaim = state.lastDay !== today;
    const nextStreak = canClaim
      ? (state.lastDay === yesterday(today) ? state.streak + 1 : 1)
      : state.streak;
    return json(200, {
      locked: !(await isPaidTier(companyId)),
      today,
      streak: state.streak,
      lastDay: state.lastDay,
      canClaim,
      nextStreak,
      nextReward: CHECKIN_REWARDS[((nextStreak - 1) % CHECKIN_REWARDS.length + CHECKIN_REWARDS.length) % CHECKIN_REWARDS.length],
      calendar: CHECKIN_REWARDS,
    });
  }

  if (event.httpMethod !== "POST") return json(405, { error: "GET or POST" });

  if (!(await isPaidTier(companyId))) {
    return json(402, { error: "Check-in is a paid feature. Upgrade to unlock it." });
  }

  // POST: claim
  if (state.lastDay === today) {
    return json(409, { error: "You've already checked in today.", streak: state.streak });
  }
  const newStreak = state.lastDay === yesterday(today) ? state.streak + 1 : 1;
  const idx = ((newStreak - 1) % CHECKIN_REWARDS.length + CHECKIN_REWARDS.length) % CHECKIN_REWARDS.length;
  const reward = CHECKIN_REWARDS[idx];

  await store.setJSON(tenantKey("checkin", companyId, userId), { lastDay: today, streak: newStreak });

  // cộng vào bonus
  let bonus = 0;
  try { const b = await store.get(tenantKey("bonus", companyId, userId)); if (b) bonus = Number(b) || 0; } catch (_) {}
  bonus += reward;
  await store.set(tenantKey("bonus", companyId, userId), String(bonus));

  return json(200, {
    ok: true,
    streak: newStreak,
    reward,
    bonusTotal: bonus,
    message: `+${reward} XU — ${newStreak}-day streak!`,
  });
};

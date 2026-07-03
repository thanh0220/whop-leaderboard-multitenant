import { pointsStore, tenantKey, casUpdate } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getTenantConfig } from "./_tenant.mjs";
import { utcDayKey } from "./_season.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

class AlreadyCheckedInError extends Error {
  constructor(streak) { super("already-checked-in"); this.streak = streak; }
}

// State per user (blob key `checkin:<companyId>:<userId>`):
//   { lastDay: "YYYY-MM-DD", streak: number }
// Bonus xu cộng vào blob `bonus:<companyId>:<userId>` (số nguyên dương).

function yesterday(dayKey) {
  const d = new Date(dayKey + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Toàn bộ handler bọc trong 1 try/catch NGOÀI CÙNG — nếu bất kỳ bước nào phía
// trên (xác thực user, lấy tenant config, đọc state...) ném lỗi bất ngờ, vẫn
// LUÔN trả JSON hợp lệ, không bao giờ "crash" trả về response không phải JSON
// (nguyên nhân khiến client báo lỗi dạng "Unexpected token ... in JSON").
export const handler = async (event) => {
  try {
    const { userId, companyId } = await getAuthContext(event);
    if (!userId) return json(401, { error: "Could not identify the user." });
    if (!companyId) return json(400, { error: "Could not identify the community (companyId)." });

    const cfg = await getTenantConfig(companyId);
    const CHECKIN_REWARDS = Array.isArray(cfg.checkinRewards) && cfg.checkinRewards.length
      ? cfg.checkinRewards
      : [10, 15, 20, 25, 30, 40, 50];

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


    // POST: claim — dùng casUpdate (không phải check rồi ghi thường) để chặn
    // nhiều request Check-in song song đều đọc thấy "chưa check-in hôm nay" và
    // đều được cộng thưởng (double-claim trong 1 ngày).
    let newStreak;
    try {
      await casUpdate(store, tenantKey("checkin", companyId, userId), (current) => {
        const cur = current && typeof current === "object"
          ? { lastDay: current.lastDay || null, streak: Number(current.streak) || 0, shieldExpiresAt: current.shieldExpiresAt || null }
          : { lastDay: null, streak: 0, shieldExpiresAt: null };
        if (cur.lastDay === today) throw new AlreadyCheckedInError(cur.streak);
        const shieldValid = cur.shieldExpiresAt && cur.shieldExpiresAt >= today;
        const isConsecutive = cur.lastDay === yesterday(today);
        if (isConsecutive || shieldValid) {
          newStreak = cur.streak + 1;
        } else {
          newStreak = 1;
        }
        return { lastDay: today, streak: newStreak, shieldExpiresAt: cur.shieldExpiresAt };
      });

      const idx = ((newStreak - 1) % CHECKIN_REWARDS.length + CHECKIN_REWARDS.length) % CHECKIN_REWARDS.length;
      const reward = CHECKIN_REWARDS[idx];

      const bonus = Number(await casUpdate(store, tenantKey("bonus", companyId, userId), (current) => {
        return String((Number(current) || 0) + reward);
      }, { type: "text" }));


      return json(200, {
        ok: true,
        streak: newStreak,
        reward,
        bonusTotal: bonus,
        message: `+${reward} XU — ${newStreak}-day streak!`,
      });
    } catch (e) {
      if (e instanceof AlreadyCheckedInError) {
        return json(409, { error: "You've already checked in today.", streak: e.streak });
      }
      return json(500, { error: e.message || "Could not process check-in." });
    }
  } catch (e) {
    return json(500, { error: e?.message || "Unexpected server error." });
  }
};

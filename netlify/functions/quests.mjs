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

// State per user (blob key `quests:<companyId>:<userId>`):
//   { day: "YYYY-MM-DD", done: ["visit","share",...] }

export const handler = async (event) => {
  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Không xác định được người dùng." });
  if (!companyId) return json(400, { error: "Không xác định được community (companyId)." });

  const cfg = await getTenantConfig(companyId);
  const DAILY_QUESTS = cfg.dailyQuests;

  const store = pointsStore();
  const today = utcDayKey();
  let st = { day: today, done: [] };
  try {
    const s = await store.get(tenantKey("quests", companyId, userId), { type: "json" });
    if (s && s.day === today && Array.isArray(s.done)) st.done = s.done;
  } catch (_) {}

  // Nhiệm vụ không set startDate/endDate = luôn hoạt động (mặc định cũ).
  // Có set thì chỉ active trong khung ngày đó; có thêm repeatDays = tái diễn
  // mỗi N ngày, độ dài mỗi lần giữ nguyên (endDate-startDate).
  const isActive = (q) => isWithinWindow(q.startDate, q.endDate, q.repeatDays, today);

  if (event.httpMethod === "GET") {
    return json(200, {
      locked: !(await isPaidTier(companyId)),
      today,
      quests: DAILY_QUESTS.map((q) => ({ ...q, done: st.done.includes(q.id), active: isActive(q) })),
    });
  }

  if (event.httpMethod !== "POST") return json(405, { error: "GET hoặc POST" });

  if (!(await isPaidTier(companyId))) {
    return json(402, { error: "Nhiệm vụ hằng ngày là tính năng trả phí. Nâng cấp để mở khoá." });
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}
  const q = DAILY_QUESTS.find((x) => x.id === body.questId);
  if (!q) return json(400, { error: "Nhiệm vụ không hợp lệ." });
  if (!isActive(q)) return json(400, { error: "Nhiệm vụ này hiện chưa/không còn hoạt động." });
  if (st.done.includes(q.id)) return json(409, { error: "Nhiệm vụ này đã hoàn thành hôm nay." });

  st.done.push(q.id);
  await store.setJSON(tenantKey("quests", companyId, userId), { day: today, done: st.done });

  let bonus = 0;
  try { const b = await store.get(tenantKey("bonus", companyId, userId)); if (b) bonus = Number(b) || 0; } catch (_) {}
  bonus += q.reward;
  await store.set(tenantKey("bonus", companyId, userId), String(bonus));

  return json(200, { ok: true, reward: q.reward, bonusTotal: bonus, message: `+${q.reward} xu — ${q.name}` });
};

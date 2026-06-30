import { pointsStore, tenantKey, casUpdate } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getTenantConfig } from "./_tenant.mjs";
import { utcDayKey } from "./_season.mjs";
import { isWithinWindow, ddiff } from "./_repeat.mjs";

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

  const cfg = await getTenantConfig(companyId);
  if (cfg.codesEnabled === false) {
    return json(200, { ok: false, disabled: true, error: "This feature is temporarily disabled." });
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}
  const code = String(body.code || "").trim().toLowerCase();
  if (!code) return json(400, { error: "Please enter a code." });

  const raw = cfg.redeemCodes[code];
  // Backward compatibility: old codes stored as a plain number (XU), new codes stored as an object { xu, startDate?, endDate? }.
  const reward = typeof raw === "number" ? { xu: raw } : raw;
  if (!reward || !reward.xu) return json(400, { error: "Invalid code." });

  const today = utcDayKey();
  if (!isWithinWindow(reward.startDate, reward.endDate, reward.repeatDays, today)) {
    return json(400, { error: "This code isn't active yet or has expired." });
  }

  // Chống dùng lại vô hạn cùng 1 mã: mỗi user chỉ redeem được 1 lần/chu kỳ.
  // Mã không lặp (repeatDays rỗng) -> chu kỳ "once" -> chỉ redeem được đúng 1 lần.
  // Mã lặp mỗi N ngày -> chu kỳ = số thứ tự lần lặp hiện tại, redeem lại được
  // khi sang chu kỳ mới (đúng thiết kế mã tái diễn hiện tại).
  const start = reward.startDate || reward.endDate || null;
  const cycleId = reward.repeatDays && start
    ? String(Math.floor(ddiff(start, today) / reward.repeatDays))
    : "once";

  const store = pointsStore();
  const redeemedKey = tenantKey("redeemed-codes", companyId, userId);
  // Cả 2 lần casUpdate bọc trong 1 try/catch DUY NHẤT — lỗi tạm thời (vd hết
  // retry do tranh chấp ETag) không được làm function crash với response
  // không phải JSON (client gọi r.json() sẽ lỗi parse nếu để lọt).
  try {
    let alreadyUsed = false;
    await casUpdate(store, redeemedKey, (current) => {
      const map = current && typeof current === "object" ? current : {};
      if (map[code] === cycleId) { alreadyUsed = true; return map; }
      return { ...map, [code]: cycleId };
    });
    if (alreadyUsed) {
      return json(409, { error: "You have already redeemed this code." });
    }

    let bonusTotal = 0;
    await casUpdate(store, tenantKey("bonus", companyId, userId), (current) => {
      const prev = Number(current) || 0;
      bonusTotal = prev + reward.xu;
      return String(bonusTotal);
    }, { type: "text" });

    return json(200, {
      ok: true,
      code,
      added: reward.xu,
      bonusTotal,
      message: `+${reward.xu} XU added!`,
    });
  } catch (e) {
    return json(500, { error: e.message || "Could not redeem this code." });
  }
};

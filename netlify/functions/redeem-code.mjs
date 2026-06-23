import { pointsStore, tenantKey } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getTenantConfig, isPaidTier } from "./_tenant.mjs";
import { utcDayKey } from "./_season.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Không xác định được người dùng." });
  if (!companyId) return json(400, { error: "Không xác định được community (companyId)." });

  if (!(await isPaidTier(companyId))) {
    return json(402, { error: "Nhập code là tính năng trả phí. Nâng cấp để mở khoá." });
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}
  const code = String(body.code || "").trim().toLowerCase();
  if (!code) return json(400, { error: "Vui lòng nhập code." });

  const cfg = await getTenantConfig(companyId);
  const raw = cfg.redeemCodes[code];
  // Tương thích ngược: code cũ lưu dạng số (xu), code mới lưu dạng object { xu, startDate?, endDate? }.
  const reward = typeof raw === "number" ? { xu: raw } : raw;
  if (!reward || !reward.xu) return json(400, { error: "Code không hợp lệ." });

  const today = utcDayKey();
  if (reward.startDate && today < reward.startDate) return json(400, { error: "Code chưa tới ngày sử dụng." });
  if (reward.endDate && today > reward.endDate) return json(400, { error: "Code đã hết hạn sử dụng." });

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
    message: `+${reward.xu} xu đã được cộng!`,
  });
};

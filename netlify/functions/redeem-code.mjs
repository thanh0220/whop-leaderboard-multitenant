import { pointsStore, tenantKey } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getTenantConfig, isPaidTier } from "./_tenant.mjs";

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
  const reward = cfg.redeemCodes[code];
  if (!reward) return json(400, { error: "Code không hợp lệ." });

  const store = pointsStore();
  let bonus = 0;
  try { const b = await store.get(tenantKey("bonus", companyId, userId)); if (b) bonus = Number(b) || 0; } catch (_) {}
  bonus += reward;
  await store.set(tenantKey("bonus", companyId, userId), String(bonus));

  return json(200, {
    ok: true,
    code,
    added: reward,
    bonusTotal: bonus,
    message: `+${reward} xu đã được cộng!`,
  });
};

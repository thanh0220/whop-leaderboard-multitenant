import { getAuthContext } from "./_auth.mjs";
import { getTenantConfig } from "./_tenant.mjs";
import { seasonInfo, utcDayKey } from "./_season.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

// GET: gộp dữ liệu cho trang Lịch sự kiện (public/events.html) — chỉ đọc
// config tĩnh của tenant, không cần biết tiến trình của riêng user nào.
//   season: luôn có (đầu tháng -> cuối tháng, từ seasonInfo() có sẵn)
//   quests: chỉ những nhiệm vụ có set startDate/endDate (nhiệm vụ thường
//     trực không set ngày thì không phải "sự kiện", không hiện ở đây)
//   codes:  chỉ những code có set startDate/endDate (cùng lý do)
export const handler = async (event) => {
  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Không xác định được người dùng." });
  if (!companyId) return json(400, { error: "Không xác định được community (companyId)." });

  const cfg = await getTenantConfig(companyId);
  const today = utcDayKey();
  const season = seasonInfo();

  const quests = (cfg.dailyQuests || [])
    .filter((q) => q.startDate || q.endDate)
    .map((q) => ({
      id: q.id,
      name: q.name,
      icon: q.icon,
      reward: q.reward,
      startDate: q.startDate || season.seasonKey + "-01",
      endDate: q.endDate || today,
    }));

  const codes = Object.entries(cfg.redeemCodes || {})
    .map(([code, v]) => (typeof v === "number" ? { code, xu: v } : { code, ...v }))
    .filter((c) => c.startDate || c.endDate)
    .map((c) => ({
      code: c.code,
      xu: c.xu,
      startDate: c.startDate || season.seasonKey + "-01",
      endDate: c.endDate || today,
    }));

  return json(200, {
    today,
    season: {
      label: season.label,
      startDate: season.seasonKey + "-01",
      endDate: season.endsAt.slice(0, 10),
      topRewards: cfg.seasonTopRewards || [],
    },
    quests,
    codes,
  });
};

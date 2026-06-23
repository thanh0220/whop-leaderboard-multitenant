import { getAuthContext } from "./_auth.mjs";
import { getTenantConfig } from "./_tenant.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

// GET: danh sách sự kiện độc lập cho trang Lịch sự kiện (public/events.html) —
// KHÔNG liên quan Nhiệm vụ/Code/Mùa giải, chỉ để thông báo (live, khuyến mãi,
// AMA, bảo trì...). Sự kiện chưa lên lịch (chưa có đủ ngày) không trả ra.
export const handler = async (event) => {
  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Không xác định được người dùng." });
  if (!companyId) return json(400, { error: "Không xác định được community (companyId)." });

  const cfg = await getTenantConfig(companyId);

  const events = (cfg.events || [])
    .filter((e) => e.startDate && e.endDate)
    .map((e) => ({
      name: e.name,
      desc: e.desc || "",
      time: e.time || "",
      link: e.link || "",
      image: e.image || null,
      repeatDays: e.repeatDays || null,
      startDate: e.startDate,
      endDate: e.endDate,
    }));

  return json(200, { events });
};

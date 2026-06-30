import { getAuthContext } from "./_auth.mjs";
import { getTenantConfig, getTierLevel } from "./_tenant.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

// GET: sự kiện độc lập (ảnh + tên + 1 ngày duy nhất) cho trang Lịch sự kiện
// (public/events.html) — KHÔNG liên quan Nhiệm vụ/Code/Mùa giải. Sự kiện chưa
// lên lịch (chưa có `date`) không trả ra member. Free 2 / Paid 10 — nếu tenant
// downgrade còn dư event đã lưu, chỉ ẩn phần dư khỏi member, KHÔNG xoá data.
export const handler = async (event) => {
  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Could not identify the user." });
  if (!companyId) return json(400, { error: "Could not identify the community (companyId)." });

  try {
    const cfg = await getTenantConfig(companyId);
    const tierLevel = await getTierLevel(companyId);
    const limit = [3, 10, 9999, 9999][tierLevel] ?? 3;
    const paid = tierLevel > 0;

    if (cfg.eventsEnabled === false) {
      return json(200, { events: [], branding: cfg.branding, isPaid: paid });
    }

    const events = (cfg.events || [])
      .slice(0, limit)
      .filter((e) => e.date)
      .map((e) => ({
        name: e.name,
        image: e.image || null,
        date: e.date,
        endDate: e.endDate || e.date,
        desc: e.desc || "",
      }));

    return json(200, { events, branding: cfg.branding, isPaid: paid });
  } catch (e) {
    return json(500, { error: e.message || "Could not load events." });
  }
};

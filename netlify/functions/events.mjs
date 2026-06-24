import { getAuthContext } from "./_auth.mjs";
import { getTenantConfig } from "./_tenant.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

// GET: tối đa 3 sự kiện độc lập (ảnh + tên + 1 ngày duy nhất) cho trang Lịch
// sự kiện (public/events.html) — KHÔNG liên quan Nhiệm vụ/Code/Mùa giải.
// Sự kiện chưa lên lịch (chưa có `date`) không trả ra member.
export const handler = async (event) => {
  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Could not identify the user." });
  if (!companyId) return json(400, { error: "Could not identify the community (companyId)." });

  const cfg = await getTenantConfig(companyId);

  const events = (cfg.events || [])
    .filter((e) => e.date)
    .map((e) => ({
      name: e.name,
      image: e.image || null,
      date: e.date,
    }));

  return json(200, { events });
};

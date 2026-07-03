import { pointsStore, tenantKey } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getTenantConfig } from "./_tenant.mjs";
import { utcDayKey } from "./_season.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

// Cờ on/off cho nav/nút ở 8 trang member — endpoint riêng, nhẹ, dùng chung cho
// mọi trang để ẨN link/nút của tính năng admin đã tắt (trước đây nav hardcode
// cứng, tắt 1 tính năng chỉ đổi nội dung TRONG trang đó, link dẫn tới nó từ các
// trang khác vẫn hiện nguyên).
export const handler = async (event) => {
  const { userId, companyId } = await getAuthContext(event);
  if (!companyId) return json(400, { error: "Could not identify the community (companyId)." });

  try {
    const cfg = await getTenantConfig(companyId);

    let dailyPending = false;
    let mailboxCount = 0;

    if (userId) {
      const store = pointsStore();
      const today = utcDayKey();
      const [checkinRaw, mailboxRaw] = await Promise.all([
        store.get(tenantKey("checkin", companyId, userId), { type: "json" }).catch(() => null),
        store.get(tenantKey("mailbox", companyId, userId), { type: "json" }).catch(() => null),
      ]);
      if (cfg.dailyEnabled !== false) {
        dailyPending = (checkinRaw?.lastDay || null) !== today;
      }
      if (cfg.mailboxEnabled !== false && Array.isArray(mailboxRaw)) {
        const now = new Date().toISOString();
        mailboxCount = mailboxRaw.filter(i => !i.claimed && (!i.expiresAt || i.expiresAt > now)).length;
      }
    }

    return json(200, {
      eventsEnabled: !!cfg.eventsEnabled,
      milestonesEnabled: !!cfg.milestoneRules?.enabled,
      codesEnabled: !!cfg.codesEnabled,
      dailyEnabled: cfg.dailyEnabled !== false,
      storeEnabled: cfg.storeEnabled !== false,
      mailboxEnabled: cfg.mailboxEnabled !== false,
      dailyPending,
      mailboxCount,
    });
  } catch (e) {
    return json(500, { error: e.message || "Could not load nav flags." });
  }
};

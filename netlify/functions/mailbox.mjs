import { pointsStore, tenantKey, casUpdate } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getTenantConfig, isPaidTier } from "./_tenant.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

class InvalidEntryError extends Error {}
class AlreadyClaimedEntryError extends Error {}
class ExpiredEntryError extends Error {}

// State per user (blob key `mailbox:<companyId>:<userId>`): mảng entry rương
// do webhook.mjs phát mỗi khi có người mua hàng — xem webhook.mjs.

export const handler = async (event) => {
  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Could not identify the user." });
  if (!companyId) return json(400, { error: "Could not identify the community (companyId)." });

  const store = pointsStore();
  const key = tenantKey("mailbox", companyId, userId);
  const now = Date.now();

  let list = [];
  try {
    const s = await store.get(key, { type: "json" });
    if (Array.isArray(s)) list = s;
  } catch (_) {}
  // Lọc bỏ entry hết hạn CHƯA nhận (đã nhận thì giữ lại để xem lịch sử gần đây).
  list = list.filter((e) => e.claimed || new Date(e.expiresAt).getTime() > now);

  if (event.httpMethod === "GET") {
    const cfg = await getTenantConfig(companyId);
    return json(200, { entries: list, branding: cfg.branding, isPaid: await isPaidTier(companyId) });
  }

  if (event.httpMethod !== "POST") return json(405, { error: "GET or POST" });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}

  // Khoá claim bằng casUpdate trên đúng list mailbox của user — chống 2
  // request claim CÙNG 1 rương song song đều pass kiểm tra "chưa claim".
  let claimedEntry = null;
  try {
    await casUpdate(store, key, (current) => {
      const curList = Array.isArray(current) ? current : [];
      const e = curList.find((x) => x.id === body.entryId);
      if (!e) throw new InvalidEntryError();
      if (e.claimed) throw new AlreadyClaimedEntryError();
      if (new Date(e.expiresAt).getTime() <= now) throw new ExpiredEntryError();
      e.claimed = true;
      claimedEntry = e;
      return curList;
    });
  } catch (e) {
    if (e instanceof InvalidEntryError) return json(400, { error: "Invalid or expired chest." });
    if (e instanceof AlreadyClaimedEntryError) return json(409, { error: "This chest has already been claimed." });
    if (e instanceof ExpiredEntryError) return json(400, { error: "This chest has expired." });
    throw e;
  }

  const bonus = Number(await casUpdate(store, tenantKey("bonus", companyId, userId), (current) => {
    return String((Number(current) || 0) + claimedEntry.xu);
  }, { type: "text" }));

  return json(200, { ok: true, xu: claimedEntry.xu, tier: claimedEntry.tier, bonusTotal: bonus, message: `+${claimedEntry.xu} XU from ${claimedEntry.label}!` });
};

import { pointsStore, tenantKey, casUpdate, claimLock, ClaimLockedError } from "./_store.mjs";
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

  // Delete all messages and promos — never touch XU chests
  if (body.action === "deleteRead") {
    const kept = list.filter(e => e.type !== "message" && e.type !== "promo");
    const deleted = list.length - kept.length;
    if (deleted > 0) await store.setJSON(key, kept);
    return json(200, { ok: true, deleted });
  }

  // Delete a single entry — only messages and promos allowed
  if (body.action === "deleteOne") {
    const entry = list.find(e => e.id === body.entryId);
    if (!entry) return json(404, { error: "Entry not found." });
    if (entry.type !== "message" && entry.type !== "promo") {
      return json(403, { error: "XU chests cannot be deleted manually." });
    }
    await store.setJSON(key, list.filter(e => e.id !== body.entryId));
    return json(200, { ok: true });
  }

  // Khoá claim bằng casUpdate trên đúng list mailbox của user — chống 2
  // request claim CÙNG 1 rương song song đều pass kiểm tra "chưa claim".
  // Cả 2 lần casUpdate bọc trong 1 try/catch DUY NHẤT — lỗi tạm thời (vd hết
  // retry do tranh chấp ETag) không làm function crash với response không
  // phải JSON (client gọi r.json() sẽ lỗi parse nếu để lọt).
  let claimedEntry = null;

  // Bước 1: lock + mark claimed
  try {
    await claimLock(store, `${companyId}:${userId}:${body.entryId}`);
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
    if (e instanceof ClaimLockedError) return json(429, { error: "Please wait a moment and try again." });
    return json(500, { error: e.message || "Could not claim this chest." });
  }

  // Bước 2: cộng XU — nếu lỗi thì rollback claimed để user retry được
  try {
    const bonus = Number(await casUpdate(store, tenantKey("bonus", companyId, userId), (current) => {
      return String((Number(current) || 0) + claimedEntry.xu);
    }, { type: "text" }));
    return json(200, { ok: true, xu: claimedEntry.xu, tier: claimedEntry.tier, bonusTotal: bonus, message: `+${claimedEntry.xu} XU from ${claimedEntry.label}!` });
  } catch (bonusErr) {
    console.error(`[mailbox] bonus write failed for ${userId} entry ${body.entryId}:`, bonusErr.message);
    try {
      await casUpdate(store, key, (current) => {
        const curList = Array.isArray(current) ? current : [];
        const e = curList.find((x) => x.id === body.entryId);
        if (e) e.claimed = false;
        return curList;
      });
    } catch (rollbackErr) {
      console.error(`[mailbox] ROLLBACK FAILED ${userId} entry ${body.entryId}:`, rollbackErr.message);
    }
    return json(500, { error: "Could not credit XU. Please try again." });
  }
};

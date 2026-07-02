import { pointsStore, tenantKey } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getTenantConfig } from "./_tenant.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Not authenticated." });
  if (!companyId) return json(400, { error: "No community found." });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}

  const { targetUserId, message } = body;
  if (!targetUserId || typeof targetUserId !== "string") return json(400, { error: "targetUserId required." });
  if (!message || typeof message !== "string" || message.trim().length < 1) return json(400, { error: "message required." });

  const text = message.trim().slice(0, 500);

  try {
    const store = pointsStore();
    const mailboxKey = tenantKey("mailbox", companyId, targetUserId);

    let list = [];
    try { list = await store.get(mailboxKey, { type: "json" }) || []; } catch (_) {}
    if (!Array.isArray(list)) list = [];

    list.unshift({
      id: crypto.randomUUID(),
      type: "message",
      tier: "message",
      label: "Message from Admin",
      message: text,
      claimed: true,
      xu: 0,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    });
    list = list.slice(0, 50);

    await store.setJSON(mailboxKey, list);
    return json(200, { ok: true });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

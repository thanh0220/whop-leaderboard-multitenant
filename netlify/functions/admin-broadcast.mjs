import { pointsStore, tenantKey } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getCompanyAccessToken, getRealCompanyId } from "./_tokens.mjs";
import { getTenantConfig } from "./_tenant.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

const isWarm = (m) => {
  if (m.paid_at) return true;
  if (m.plan_price && Number(m.plan_price) > 0) return true;
  if (m.paid_amount && Number(m.paid_amount) > 0) return true;
  if (m.plan && m.plan.price && Number(m.plan.price) > 0) return true;
  if (m.plan && m.plan.billing_period && m.plan.billing_period !== "one-time-payment" && m.plan.price > 0) return true;
  return false;
};

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Not authenticated." });
  if (!companyId) return json(400, { error: "No community found." });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}

  const { message, target } = body;
  if (!message || typeof message !== "string" || !message.trim()) return json(400, { error: "message required." });
  if (!["warm", "cold", "all"].includes(target)) return json(400, { error: "target must be warm, cold, or all." });

  const text = message.trim().slice(0, 500);

  try {
    const cfg = await getTenantConfig(companyId);
    const apiKey = await getCompanyAccessToken(companyId);
    const realCompanyId = await getRealCompanyId(companyId, cfg);
    const store = pointsStore();

    // Collect all member user IDs (paginated, max 10 pages = 1000 members)
    const targets = [];
    for (let page = 1; page <= 10; page++) {
      let r;
      try {
        r = await fetch(
          `https://api.whop.com/api/v1/memberships?company_id=${encodeURIComponent(realCompanyId)}&page=${page}&per_page=100&expand[]=user&expand[]=plan`,
          { headers: { Authorization: `Bearer ${apiKey}` } }
        );
      } catch (_) { break; }
      if (!r.ok) break;
      const j = await r.json().catch(() => ({}));
      const data = j.data || [];
      if (data.length === 0) break;

      for (const m of data) {
        const u = m.user && typeof m.user === "object" ? m.user : null;
        const uid = u ? u.id : (typeof m.user === "string" ? m.user : m.user_id || "");
        if (!uid) continue;
        const warm = isWarm(m);
        if (target === "all" || (target === "warm" && warm) || (target === "cold" && !warm)) {
          targets.push(uid);
        }
      }

      // No next page
      if (!j.next_page && !j.pagination?.next) break;
    }

    if (targets.length === 0) return json(200, { sent: 0, message: "No members matched." });

    // Write mailbox entry for each member (sequential to avoid blob conflicts)
    let sent = 0;
    const entry = {
      id: crypto.randomUUID(),
      type: "message",
      tier: "message",
      label: "Message from Admin",
      message: text,
      claimed: true,
      xu: 0,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    };

    // Batch in chunks of 10 concurrent writes
    const CHUNK = 10;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const chunk = targets.slice(i, i + CHUNK);
      await Promise.all(chunk.map(async (uid) => {
        try {
          const key = tenantKey("mailbox", companyId, uid);
          let list = [];
          try { list = await store.get(key, { type: "json" }) || []; } catch (_) {}
          if (!Array.isArray(list)) list = [];
          list.unshift({ ...entry, id: crypto.randomUUID() });
          list = list.slice(0, 50);
          await store.setJSON(key, list);
          sent++;
        } catch (_) {}
      }));
    }

    return json(200, { sent, total: targets.length });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

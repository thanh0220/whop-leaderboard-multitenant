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
  // Whop v1 membership fields — check multiple possible indicators
  if (m.paid_at) return true;
  if (m.renewable === true) return true;
  if (m.status === "active" && m.cancel_at_period_end === false) return true;
  if (m.plan_price && Number(m.plan_price) > 0) return true;
  if (m.paid_amount && Number(m.paid_amount) > 0) return true;
  if (m.plan && typeof m.plan === "object") {
    if (Number(m.plan.price) > 0) return true;
    if (m.plan.billing_period && m.plan.billing_period !== "free") return true;
    if (m.plan.base_currency_price && Number(m.plan.base_currency_price) > 0) return true;
  }
  return false;
};

async function fetchAllMembers(realCompanyId, apiKey) {
  // Map keyed by userId — deduplicate (Whop returns multiple memberships per user)
  const warmMap = new Map(), coldMap = new Map();
  for (let page = 1; page <= 10; page++) {
    let r;
    try {
      r = await fetch(
        `https://api.whop.com/api/v1/memberships?company_id=${encodeURIComponent(realCompanyId)}&page=${page}&per_page=100&expand[]=user&expand[]=plan&status[]=active&status[]=canceled&status[]=expired&status[]=churned&status[]=trialing`,
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
      const username = u ? (u.username || u.name || uid) : uid;
      // If already warm, keep warm regardless of other memberships
      if (isWarm(m)) {
        warmMap.set(uid, { userId: uid, username });
        coldMap.delete(uid);
      } else if (!warmMap.has(uid)) {
        coldMap.set(uid, { userId: uid, username });
      }
    }
    if (!j.next_page && !j.pagination?.next) break;
  }
  return { warm: [...warmMap.values()], cold: [...coldMap.values()] };
}

async function sendViaWhopSupportChat(realCompanyId, apiKey, userId, content, botName = null) {
  // Step 1: get or create support channel for this user
  const chanR = await fetch("https://api.whop.com/api/v1/support_channels", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ company_id: realCompanyId, user_id: userId }),
  });
  if (!chanR.ok) {
    const t = await chanR.text().catch(() => "");
    throw new Error(`support_channel ${chanR.status}: ${t.slice(0, 100)}`);
  }
  const chan = await chanR.json();

  // Step 2: send message into that channel
  const msgBody = { channel_id: chan.id, content };
  if (botName) msgBody.agent_name = botName; // custom chatbot display name
  const msgR = await fetch("https://api.whop.com/api/v1/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(msgBody),
  });
  if (!msgR.ok) {
    const t = await msgR.text().catch(() => "");
    throw new Error(`message ${msgR.status}: ${t.slice(0, 100)}`);
  }
}

export const handler = async (event) => {
  if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "GET or POST only" });

  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Not authenticated." });
  if (!companyId) return json(400, { error: "No community found." });

  try {
    const cfg = await getTenantConfig(companyId);
    const apiKey = await getCompanyAccessToken(companyId);
    const realCompanyId = await getRealCompanyId(companyId, cfg);
    const { warm, cold } = await fetchAllMembers(realCompanyId, apiKey);

    // GET — preview warm/cold breakdown
    if (event.httpMethod === "GET") {
      return json(200, { warm, cold, warmCount: warm.length, coldCount: cold.length });
    }

    // POST — send broadcast
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch (_) {}
    const { message, target, channel, imageUrl } = body;
    if (!message || typeof message !== "string" || !message.trim()) return json(400, { error: "message required." });
    if (!["warm", "cold", "all"].includes(target)) return json(400, { error: "target must be warm, cold, or all." });

    const sendChannel = ["whop", "mailbox", "both"].includes(channel) ? channel : "whop";
    const rawText = message.trim().slice(0, 500);
    // Prepend image URL if provided — Whop renders URLs in support chat
    const text = (typeof imageUrl === "string" && imageUrl.trim())
      ? `${imageUrl.trim()}\n\n${rawText}`
      : rawText;
    const botName = cfg.chatbotName || null;
    const targets = target === "warm" ? warm : target === "cold" ? cold : [...warm, ...cold];
    if (targets.length === 0) return json(200, { sent: 0, failed: 0 });

    const store = (sendChannel === "mailbox" || sendChannel === "both") ? pointsStore() : null;
    let sent = 0, failed = 0;
    const errors = [];
    const CHUNK = 5;
    for (let i = 0; i < targets.length; i += CHUNK) {
      await Promise.all(targets.slice(i, i + CHUNK).map(async ({ userId: uid }) => {
        try {
          if (sendChannel === "whop" || sendChannel === "both") {
            await sendViaWhopSupportChat(realCompanyId, apiKey, uid, text, botName);
          }
          if (sendChannel === "mailbox" || sendChannel === "both") {
            const key = tenantKey("mailbox", companyId, uid);
            let list = [];
            try { list = await store.get(key, { type: "json" }) || []; } catch (_) {}
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
            await store.setJSON(key, list.slice(0, 50));
          }
          sent++;
        } catch (e) {
          failed++;
          if (errors.length < 3) errors.push(`${uid}: ${e.message}`);
        }
      }));
    }

    return json(200, { sent, failed, total: targets.length, errors });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

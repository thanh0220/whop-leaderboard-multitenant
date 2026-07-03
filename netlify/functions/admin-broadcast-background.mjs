import { pointsStore, tenantKey } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getCompanyAccessToken, getRealCompanyId } from "./_tokens.mjs";
import { getTenantConfig } from "./_tenant.mjs";

// Netlify Background Function — named with -background suffix → no HTTP timeout (up to 15 min).
// Client POSTs { jobId, message, target, channel, imageUrl } and receives 202 immediately.
// This function runs in the background, writing progress to blob bcast-job:{companyId}:{jobId}.
// Client polls GET /admin-broadcast?jobId={jobId} to check status.

const isWarm = (m) => {
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

async function sendViaWhopSupportChat(realCompanyId, apiKey, userId, content) {
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
  const msgR = await fetch("https://api.whop.com/api/v1/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel_id: chan.id, content }),
  });
  if (!msgR.ok) {
    const t = await msgR.text().catch(() => "");
    throw new Error(`message ${msgR.status}: ${t.slice(0, 100)}`);
  }
}

export const handler = async (event) => {
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}
  const { jobId, message, target, channel, imageUrl } = body;

  const store = pointsStore();

  const writeResult = async (data) => {
    try {
      await store.setJSON("bcast-job:" + (jobId || "noid"), data);
    } catch (_) {}
  };

  if (!jobId) return { statusCode: 200, body: "" };

  const { userId, companyId } = await getAuthContext(event);
  if (!userId || !companyId) {
    await writeResult({ done: true, error: "Auth failed", sent: 0, failed: 0, total: 0 });
    return { statusCode: 200, body: "" };
  }

  try {
    const cfg = await getTenantConfig(companyId);
    const apiKey = await getCompanyAccessToken(companyId);
    const realCompanyId = await getRealCompanyId(companyId, cfg);
    const { warm, cold } = await fetchAllMembers(realCompanyId, apiKey);

    const targets = target === "warm" ? warm : target === "cold" ? cold : [...warm, ...cold];
    const rawText = (message || "").trim().slice(0, 500);
    const text = (typeof imageUrl === "string" && imageUrl.trim())
      ? `${imageUrl.trim()}\n\n${rawText}`
      : rawText;

    let sent = 0, failed = 0;
    const errors = [];
    // Small chunk + 300ms pause between batches to avoid Whop API rate limits.
    // Background function has no timeout so sequential is fine.
    const CHUNK = 3;

    // Write initial progress so client knows we started
    await writeResult({ done: false, sent: 0, failed: 0, total: targets.length });

    for (let i = 0; i < targets.length; i += CHUNK) {
      await Promise.all(targets.slice(i, i + CHUNK).map(async ({ userId: uid }) => {
        try {
          if (channel === "whop" || channel === "both") {
            await sendViaWhopSupportChat(realCompanyId, apiKey, uid, text);
          }
          if (channel === "mailbox" || channel === "both") {
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
          if (errors.length < 5) errors.push(`${uid}: ${e.message}`);
        }
      }));
      // Update progress + pause between batches (rate limit safety)
      await writeResult({ done: false, sent, failed, total: targets.length });
      await new Promise(r => setTimeout(r, 300));
    }

    await writeResult({ done: true, sent, failed, total: targets.length, errors });
  } catch (err) {
    await writeResult({ done: true, error: err.message, sent: 0, failed: 0, total: 0 });
  }

  return { statusCode: 200, body: "" };
};

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

async function fetchTargetUserIds(realCompanyId, apiKey, target) {
  const ids = [];
  const seen = new Set();
  let apiFailed = false;
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(
      `https://api.whop.com/api/v1/memberships?company_id=${encodeURIComponent(realCompanyId)}&page=${page}&per_page=100&expand[]=user&status[]=active&status[]=trialing`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (!r.ok) {
      apiFailed = true;
      break;
    }
    const j = await r.json().catch(() => ({}));
    const data = j.data || [];
    if (!data.length) break;
    for (const m of data) {
      const uid = m.user?.id || (typeof m.user === "string" ? m.user : null) || m.user_id;
      if (!uid || seen.has(uid)) continue;
      seen.add(uid);
      if (target === "all") ids.push(uid);
      else if (target === "warm" && isWarm(m)) ids.push(uid);
      else if (target === "cold" && !isWarm(m)) ids.push(uid);
    }
    if (!j.next_page && !j.pagination?.next) break;
  }
  return { ids, apiFailed };
}

const ENROLL_CHUNK = 15;

// Enroll 1 user vào 1 sequence — dùng từ webhook khi member mới join
export async function enrollSingleUser(store, companyId, userId, sequenceId) {
  const key = tenantKey("drip-enroll", companyId, userId, sequenceId);
  const existing = await store.get(key, { type: "json" }).catch(() => null);
  if (existing && !existing.completed) return "skipped";
  await store.setJSON(key, {
    userId,
    sequenceId,
    step: 0,
    enrolledAt: new Date().toISOString(),
    nextSendAt: new Date().toISOString(),
    completed: false,
  });
  return "enrolled";
}

// POST — enroll or unenroll users in a drip sequence
// Body: { sequenceId, target: "single"|"warm"|"cold"|"all", userId?, unenroll? }
export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const { userId: adminId, companyId } = await getAuthContext(event);
  if (!adminId) return json(401, { error: "Not authenticated." });
  if (!companyId) return json(400, { error: "No community found." });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}

  const { sequenceId, target, userId: singleId, unenroll = false } = body;
  if (!sequenceId) return json(400, { error: "sequenceId required." });
  if (!["single", "warm", "cold", "all"].includes(target)) {
    return json(400, { error: "target must be single|warm|cold|all." });
  }
  if (target === "single" && !singleId) return json(400, { error: "userId required for target=single." });

  try {
    const cfg = await getTenantConfig(companyId);
    const seq = (cfg.dripSequences || []).find(s => s.id === sequenceId);
    if (!seq) return json(404, { error: `Sequence "${sequenceId}" not found in config.` });

    const hasContent = (seq.steps || []).some(s => s.message && s.message.trim());
    if (!hasContent) return json(400, { error: "Sequence has no steps with content." });

    const store = pointsStore();
    const now = new Date().toISOString();

    let userIds = [];
    let apiFailed = false;

    if (target === "single") {
      userIds = [singleId];
    } else {
      const apiKey = await getCompanyAccessToken(companyId);
      const realCompanyId = await getRealCompanyId(companyId, cfg);
      const result = await fetchTargetUserIds(realCompanyId, apiKey, target);
      userIds = result.ids;
      apiFailed = result.apiFailed;
    }

    let enrolled = 0, unenrolled = 0, skipped = 0;

    for (let i = 0; i < userIds.length; i += ENROLL_CHUNK) {
      const chunk = userIds.slice(i, i + ENROLL_CHUNK);
      await Promise.all(chunk.map(async (uid) => {
        const key = tenantKey("drip-enroll", companyId, uid, sequenceId);

        if (unenroll) {
          await store.delete(key).catch(() => {});
          unenrolled++;
          return;
        }

        const existing = await store.get(key, { type: "json" }).catch(() => null);
        if (existing && !existing.completed) { skipped++; return; }

        await store.setJSON(key, {
          userId: uid,
          sequenceId,
          step: 0,
          enrolledAt: now,
          nextSendAt: now,
          completed: false,
        });
        enrolled++;
      }));
    }

    return json(200, {
      ok: true,
      enrolled,
      unenrolled,
      skipped,
      total: userIds.length,
      warning: apiFailed ? "Whop API returned an error — member list may be incomplete." : undefined,
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

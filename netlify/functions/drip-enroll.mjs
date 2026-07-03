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
  }
  return false;
};

async function fetchTargetUserIds(realCompanyId, apiKey, target) {
  const ids = [];
  const seen = new Set();
  for (let page = 1; page <= 5; page++) {
    const r = await fetch(
      `https://api.whop.com/api/v1/memberships?company_id=${encodeURIComponent(realCompanyId)}&page=${page}&per_page=100&expand[]=user&status[]=active&status[]=trialing`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (!r.ok) break;
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
  return ids;
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
    if (!cfg.dripEnabled) return json(400, { error: "Drip sequences are disabled. Enable dripEnabled in settings." });

    const seq = (cfg.dripSequences || []).find(s => s.id === sequenceId);
    if (!seq) return json(404, { error: `Sequence "${sequenceId}" not found in config.` });

    const apiKey = await getCompanyAccessToken(companyId);
    const realCompanyId = await getRealCompanyId(companyId, cfg);
    const store = pointsStore();
    const now = new Date().toISOString();

    const userIds = target === "single"
      ? [singleId]
      : await fetchTargetUserIds(realCompanyId, apiKey, target);

    let enrolled = 0, unenrolled = 0, skipped = 0;

    for (const uid of userIds) {
      // Key includes sequenceId so a user can be in multiple sequences simultaneously
      const key = tenantKey("drip-enroll", companyId, uid, sequenceId);

      if (unenroll) {
        await store.delete(key).catch(() => {});
        unenrolled++;
        continue;
      }

      // Skip if already enrolled and not completed
      const existing = await store.get(key, { type: "json" }).catch(() => null);
      if (existing && !existing.completed) { skipped++; continue; }

      // step 0 with nextSendAt = now so drip.mjs picks it up immediately
      await store.setJSON(key, {
        userId: uid,
        sequenceId,
        step: 0,
        enrolledAt: now,
        nextSendAt: now,
        completed: false,
      });
      enrolled++;
    }

    return json(200, { ok: true, enrolled, unenrolled, skipped, total: userIds.length });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

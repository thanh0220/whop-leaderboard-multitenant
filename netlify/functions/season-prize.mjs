import { getTenantConfig } from "./_tenant.mjs";
import { pointsStore, tenantKey } from "./_store.mjs";

// Netlify Scheduled Function — chạy ngày 1 mỗi tháng lúc 01:00 UTC
// Schedule: schedule = "0 1 1 * *" (trong netlify.toml)
// Phân phối XU tự động cho top VIP Members và top Referrals tháng trước

export const handler = async (event) => {
  const isManual = event.httpMethod === "POST";
  if (isManual) {
    const secret = process.env.SEASON_PRIZE_SECRET;
    if (!secret || event.queryStringParameters?.secret !== secret) {
      return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
    }
  }
  const overrideSeason = isManual && event.queryStringParameters?.season;

  const now = new Date();
  let prevSeasonKey;
  if (overrideSeason) {
    prevSeasonKey = overrideSeason;
  } else {
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    prevSeasonKey = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  const store = pointsStore();
  let tenantIds = [];
  try {
    tenantIds = await store.get(tenantKey("tenant-registry", "all"), { type: "json" }).catch(() => null) || [];
  } catch (_) {}

  if (tenantIds.length === 0) {
    console.log("[season-prize] No tenants in registry.");
    return { statusCode: 200, body: JSON.stringify({ ok: true, distributed: 0 }) };
  }

  let distributed = 0, skipped = 0, errors = 0;
  const log = [];

  for (const companyId of tenantIds) {
    try {
      const cfg = await getTenantConfig(companyId);
      const prizeNow = Date.now();
      const expiresAt = new Date(prizeNow + 90 * 86400000).toISOString();

      const [vipResult, refResult] = await Promise.all([
        distributePool({
          store, companyId, prevSeasonKey, isManual, prizeNow, expiresAt,
          snapshotScope: "season-snapshot-vip",
          guardScope:    "season-prize-sent-vip",
          rewards:       (cfg.seasonVipTopRewards || []).filter(r => Number(r.xu) > 0),
          labelPrefix:   "VIP",
          entryIcon:     "🏆",
        }),
        distributePool({
          store, companyId, prevSeasonKey, isManual, prizeNow, expiresAt,
          snapshotScope: "season-snapshot-ref",
          guardScope:    "season-prize-sent-ref",
          rewards:       (cfg.seasonRefTopRewards || []).filter(r => Number(r.xu) > 0),
          labelPrefix:   "Referral",
          entryIcon:     "🏅",
        }),
      ]);

      if (vipResult.ok || refResult.ok) distributed++;
      else skipped++;
      log.push({ companyId, vip: vipResult, ref: refResult });
    } catch (err) {
      console.error(`[season-prize] Failed for tenant ${companyId}:`, err.message);
      errors++;
      log.push({ companyId, result: "error", error: err.message });
    }
  }

  console.log(`[season-prize] season=${prevSeasonKey} distributed:${distributed} skipped:${skipped} errors:${errors}`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, season: prevSeasonKey, distributed, skipped, errors, log }) };
};

async function distributePool({ store, companyId, prevSeasonKey, isManual, prizeNow, expiresAt, snapshotScope, guardScope, rewards, labelPrefix, entryIcon }) {
  if (rewards.length === 0) return { skipped: true, reason: "no-rewards" };

  const sentKey = tenantKey(guardScope, companyId, prevSeasonKey);
  const alreadySent = await store.get(sentKey, { type: "text" }).catch(() => null);
  if (alreadySent && !isManual) return { skipped: true, reason: "already-sent" };

  const snapshotKey = tenantKey(snapshotScope, companyId, prevSeasonKey);
  const snapshot = await store.get(snapshotKey, { type: "json" }).catch(() => null);
  if (!snapshot || !Array.isArray(snapshot.top) || snapshot.top.length === 0) {
    console.warn(`[season-prize] No ${snapshotScope} snapshot for tenant ${companyId} season ${prevSeasonKey}`);
    return { skipped: true, reason: "no-snapshot" };
  }

  const sent = [];
  for (let i = 0; i < rewards.length; i++) {
    const r = rewards[i];
    const xu = Number(r.xu);
    const winner = snapshot.top[i];
    if (!winner || !winner.userId) continue;

    const entry = {
      id: `season-prize-${prevSeasonKey}-${labelPrefix.toLowerCase()}-rank-${i + 1}-${winner.userId}`,
      label: `${entryIcon} ${labelPrefix} ${r.rank} — Season ${prevSeasonKey}`,
      desc: `Automatic ${labelPrefix} season prize · ${prevSeasonKey}`,
      icon: entryIcon,
      tier: "gold",
      xu,
      expiresAt,
      claimed: false,
    };

    const mailboxKey = tenantKey("mailbox", companyId, winner.userId);
    let list = [];
    try {
      const s = await store.get(mailboxKey, { type: "json" });
      if (Array.isArray(s)) list = s;
    } catch (_) {}
    list = list.filter(e => !e.claimed || new Date(e.expiresAt).getTime() > prizeNow - 14 * 86400000);
    list = list.filter(e => e.id !== entry.id);
    list.unshift(entry);
    list = list.slice(0, 50);
    await store.setJSON(mailboxKey, list);
    sent.push({ rank: i + 1, userId: winner.userId, username: winner.username, xu });
  }

  await store.setJSON(sentKey, { distributedAt: new Date().toISOString(), seasonKey: prevSeasonKey, sent });
  return { ok: true, sent };
}

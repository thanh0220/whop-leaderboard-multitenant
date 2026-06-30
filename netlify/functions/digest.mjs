import { getTenantConfig } from "./_tenant.mjs";
import { pointsStore, tenantKey } from "./_store.mjs";
import { getRealCompanyId, getCompanyAccessToken } from "./_tokens.mjs";

// Netlify Scheduled Function — chạy mỗi thứ Hai 08:00 UTC
// Schedule được đăng ký trong netlify.toml: schedule = "0 8 * * 1"
// Gửi weekly stats email cho owner nào đã opt-in digestEnabled=true

async function getAnalyticsStats(companyId, cfg) {
  const store = pointsStore();
  try {
    // Đọc từ analytics cache nếu còn mới (< 24h)
    const cached = await store.get(tenantKey("analytics-cache", companyId), { type: "json" }).catch(() => null);
    if (cached?.cachedAt && Date.now() - new Date(cached.cachedAt).getTime() < 86_400_000) {
      return cached;
    }
  } catch (_) {}
  return null; // Không có cache mới → skip stats chi tiết
}

function buildEmailHtml(displayName, stats, adminUrl) {
  const memberCount  = stats?.totalMembers ?? "—";
  const activeWeek   = stats?.checkInsWeek ?? "—";
  const rate7d       = stats?.checkInRate7d ?? "—";
  const avgStreak    = stats?.avgStreak ?? "—";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Weekly Community Digest</title></head>
<body style="font-family:system-ui,sans-serif;background:#f9fafb;padding:24px;margin:0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
    <div style="background:#7c3aed;padding:24px;color:#fff">
      <h2 style="margin:0;font-size:20px">📊 Weekly Digest</h2>
      <p style="margin:4px 0 0;opacity:.85;font-size:14px">${displayName}</p>
    </div>
    <div style="padding:24px">
      <p style="color:#374151;font-size:15px">Here's how your community performed this week:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr style="background:#f3f4f6">
          <td style="padding:12px;border-radius:6px;font-size:14px;color:#6b7280">👥 Total Members</td>
          <td style="padding:12px;font-size:20px;font-weight:700;color:#111">${memberCount}</td>
        </tr>
        <tr>
          <td style="padding:12px;font-size:14px;color:#6b7280">📅 Active This Week</td>
          <td style="padding:12px;font-size:20px;font-weight:700;color:#111">${activeWeek} <span style="font-size:14px;color:#7c3aed">(${rate7d}%)</span></td>
        </tr>
        <tr style="background:#f3f4f6">
          <td style="padding:12px;border-radius:6px;font-size:14px;color:#6b7280">🔥 Avg Check-in Streak</td>
          <td style="padding:12px;font-size:20px;font-weight:700;color:#111">${avgStreak} days</td>
        </tr>
      </table>
      <a href="${adminUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
        View Full Dashboard →
      </a>
    </div>
    <div style="padding:16px 24px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af">
      You're receiving this because you enabled Weekly Digest in your EngageXU admin settings.
      To unsubscribe, disable it in your <a href="${adminUrl}" style="color:#7c3aed">admin panel</a>.
    </div>
  </div>
</body>
</html>`;
}

async function sendEmail(to, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not configured");

  const from = process.env.DIGEST_FROM_EMAIL || "digest@engagexu.com";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => "unknown");
    throw new Error(`Resend error ${r.status}: ${err.slice(0, 200)}`);
  }
  return true;
}

export const handler = async (event) => {
  // Cho phép trigger thủ công qua POST (để test)
  const isManual = event.httpMethod === "POST";

  if (!process.env.RESEND_API_KEY) {
    console.warn("[digest] RESEND_API_KEY not set — skipping all emails.");
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: "no-api-key" }) };
  }

  const store = pointsStore();
  let tenantIds = [];
  try {
    tenantIds = await store.get(tenantKey("tenant-registry", "all"), { type: "json" }).catch(() => null) || [];
  } catch (_) {}

  if (tenantIds.length === 0) {
    console.log("[digest] No tenants in registry.");
    return { statusCode: 200, body: JSON.stringify({ ok: true, sent: 0 }) };
  }

  const siteUrl = process.env.URL || process.env.DEPLOY_URL || "https://yourapp.netlify.app";
  let sent = 0, skipped = 0, errors = 0;

  for (const companyId of tenantIds) {
    try {
      const cfg = await getTenantConfig(companyId);
      if (!cfg.digestEnabled || !cfg.digestEmail) { skipped++; continue; }

      const displayName = cfg.branding?.displayName || "Your Community";
      const stats = await getAnalyticsStats(companyId, cfg);
      const adminUrl = `${siteUrl}/admin.html`;
      const html = buildEmailHtml(displayName, stats, adminUrl);
      const subject = `📊 Your Community This Week — ${displayName}`;

      await sendEmail(cfg.digestEmail, subject, html);

      // Ghi timestamp lần gửi cuối
      try { await store.setJSON(tenantKey("digest-last-sent", companyId), { sentAt: new Date().toISOString() }); } catch (_) {}
      sent++;
    } catch (err) {
      console.error(`[digest] Failed for tenant ${companyId}:`, err.message);
      errors++;
    }
  }

  console.log(`[digest] Done — sent:${sent} skipped:${skipped} errors:${errors}`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, sent, skipped, errors }) };
};

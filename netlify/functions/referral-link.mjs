import { pointsStore, tenantKey } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getCompanyAccessToken, getRealCompanyId } from "./_tokens.mjs";
import { getTenantConfig } from "./_tenant.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

const WHOP_API_V5 = "https://api.whop.com/api/v5";

export const handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "GET only" });

  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Could not identify user." });
  if (!companyId) return json(400, { error: "Could not identify community." });

  try {
    const cfg = await getTenantConfig(companyId);

    if (!cfg.referralLinkEnabled) {
      return json(403, { error: "Referral links not enabled. Admin: turn on in Settings → Automations." });
    }

    const store = pointsStore();
    const blobKey = tenantKey("referral-link", companyId, userId);

    let blob = null;
    try { blob = await store.get(blobKey, { type: "json" }); } catch (_) {}
    if (blob && blob.linkUrl) {
      return json(200, { linkUrl: blob.linkUrl, linkId: blob.linkId || "" });
    }

    const destUrl = cfg.referralDestUrl || "";
    if (!destUrl) {
      return json(503, {
        error: "no_dest_url",
        hint: "Admin: set Referral Destination URL in Settings → Automations before enabling referral links.",
      });
    }

    const apiKey = await getCompanyAccessToken(companyId);
    const realCompanyId = await getRealCompanyId(companyId, cfg);

    const r = await fetch(
      `${WHOP_API_V5}/tracking_links?company_id=${encodeURIComponent(realCompanyId)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Referral — ${userId}`, destination_url: destUrl }),
      }
    );

    if (!r.ok) {
      if (r.status === 401 || r.status === 403) {
        return json(503, {
          error: "permission_required",
          hint: "Add tracking_link:create permission in Whop Developer console, then have admins re-authorize.",
        });
      }
      const text = await r.text().catch(() => "");
      return json(502, { error: `Whop API error ${r.status}`, detail: text.slice(0, 300) });
    }

    const data = await r.json();
    const linkId = data.id || "";
    const linkUrl = data.url || data.link_url || data.short_url || destUrl;

    try {
      await store.setJSON(blobKey, { linkId, linkUrl, createdAt: new Date().toISOString() });
    } catch (_) {}

    return json(200, { linkUrl, linkId });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

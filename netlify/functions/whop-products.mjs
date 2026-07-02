import { getAuthContext } from "./_auth.mjs";
import { getCompanyAccessToken, getRealCompanyId } from "./_tokens.mjs";
import { getTenantConfig } from "./_tenant.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

export const handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "GET only" });

  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Not authenticated." });
  if (!companyId) return json(400, { error: "No community found." });

  try {
    const cfg = await getTenantConfig(companyId);
    const apiKey = await getCompanyAccessToken(companyId);
    const realCompanyId = await getRealCompanyId(companyId, cfg);

    // Try v5 products first, fall back to v1
    let products = [];

    const tryFetch = async (url) => {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!r.ok) return null;
      return r.json();
    };

    // v5 products endpoint
    const v5 = await tryFetch(
      `https://api.whop.com/api/v5/products?company_id=${encodeURIComponent(realCompanyId)}&page=1&per=50`
    );

    if (v5 && Array.isArray(v5.data) && v5.data.length > 0) {
      products = v5.data.map((p) => ({
        id: p.id || "",
        name: p.name || p.title || p.id || "Product",
        url: p.url || p.checkout_url || p.hub_url || "",
        visibility: p.visibility || "",
      })).filter((p) => p.url);
    }

    // Fallback: v1 experiences (app views — has product checkout links)
    if (products.length === 0) {
      const appId = process.env.WHOP_APP_ID || process.env.NEXT_PUBLIC_WHOP_APP_ID || "";
      const v1url = appId
        ? `https://api.whop.com/api/v1/experiences?company_id=${encodeURIComponent(realCompanyId)}&app_id=${encodeURIComponent(appId)}`
        : `https://api.whop.com/api/v1/experiences?company_id=${encodeURIComponent(realCompanyId)}`;

      const v1 = await tryFetch(v1url);
      if (v1 && Array.isArray(v1.data)) {
        products = v1.data.map((e) => ({
          id: e.id || "",
          name: e.name || e.title || e.id || "Product",
          url: e.product_url || e.url || e.checkout_url || "",
          visibility: "",
        })).filter((p) => p.url);
      }
    }

    // Fallback: memberships to find unique plan/product slugs
    if (products.length === 0) {
      const ms = await tryFetch(
        `https://api.whop.com/api/v1/memberships?company_id=${encodeURIComponent(realCompanyId)}&page=1&per_page=10`
      );
      if (ms && Array.isArray(ms.data)) {
        const seen = new Set();
        for (const m of ms.data) {
          const slug = m.plan_id || m.product_id || "";
          const url = m.checkout_url || m.product_url || "";
          if (url && !seen.has(url)) {
            seen.add(url);
            products.push({ id: slug, name: m.product_name || slug || "Product", url });
          }
        }
      }
    }

    return json(200, { products, realCompanyId });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

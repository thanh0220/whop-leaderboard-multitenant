import { pointsStore, tenantKey } from "./_store.mjs";
import { DEFAULT_TENANT } from "./_defaults.mjs";

function deepMerge(base, override) {
  if (Array.isArray(base)) return Array.isArray(override) ? override : base;
  if (typeof base !== "object" || base === null) return override ?? base;
  const out = { ...base };
  for (const k of Object.keys(override || {})) {
    out[k] = deepMerge(base[k], override[k]);
  }
  return out;
}

// One-time migrations applied at read time to any tenant config.
// Safe to run repeatedly — each check is idempotent (only acts when field absent).
function migrateConfig(cfg) {
  if (cfg.events?.length) {
    cfg.events = cfg.events.map(e => {
      if (e.id === 'event_1' && !e.recurringDays)
        return { ...e, date: '', endDate: '', recurringDays: [1,2,3,4] };
      if (e.id === 'event_2' && !e.recurringDays)
        return { ...e, date: '', endDate: '', recurringDays: [5,6,0] };
      return e;
    });
  }
  return cfg;
}

// Đọc config của 1 tenant; nếu chưa tồn tại thì tạo từ DEFAULT_TENANT (lazy
// init — không cần bước "cài đặt" riêng để tenant hoạt động được ngay).
// Nếu đã tồn tại, merge defaults bên dưới config đã lưu — field mới thêm sau
// này (ví dụ thêm quest type mới) tự có ở tenant cũ mà không cần migration.
export async function getTenantConfig(companyId) {
  if (!companyId) throw new Error("getTenantConfig: thiếu companyId.");
  const store = pointsStore();
  const key = tenantKey("tenant", companyId);

  let saved = null;
  try { saved = await store.get(key, { type: "json" }); } catch (_) {}

  if (!saved) {
    const fresh = { ...DEFAULT_TENANT, companyId, createdAt: new Date().toISOString() };
    try { await store.setJSON(key, fresh); } catch (_) {}
    return fresh;
  }

  return migrateConfig(deepMerge({ ...DEFAULT_TENANT, companyId }, saved));
}

export async function saveTenantConfig(companyId, partialConfig) {
  if (!companyId) throw new Error("saveTenantConfig: thiếu companyId.");
  const store = pointsStore();
  const key = tenantKey("tenant", companyId);
  const current = await getTenantConfig(companyId);
  const merged = deepMerge(current, partialConfig);
  await store.setJSON(key, merged);

  // companyId ở trên là tenantId giả (subdomain referer — xem _auth.mjs),
  // KHÁC với company_id thật (biz_xxx) admin tự dán vào whopCompanyId. Webhook
  // (webhook.mjs) chỉ nhận được company_id thật từ Whop, không có subdomain —
  // cần bảng tra ngược để map về đúng tenant.
  if (merged.whopCompanyId) {
    try { await store.set(tenantKey("tenant-by-realid", merged.whopCompanyId), companyId); } catch (_) {}
  }

  return merged;
}

// Dùng bởi webhook.mjs: từ company_id THẬT (biz_xxx) trong payload webhook,
// tìm ra tenantId giả tương ứng đã lưu config. Trả null nếu chưa tenant nào
// từng dán đúng whopCompanyId này qua Settings.
export async function getTenantIdByRealCompanyId(realCompanyId) {
  if (!realCompanyId) return null;
  const store = pointsStore();
  try {
    const tenantId = await store.get(tenantKey("tenant-by-realid", realCompanyId));
    return tenantId || null;
  } catch (_) {
    return null;
  }
}

// Trang member (Experience View) chỉ nhận được experienceId thật từ Whop,
// KHÔNG nhận companyId — cần bảng tra ngược riêng (khác "tenant-by-realid" ở
// trên, vốn tra theo company_id thật cho webhook). Bảng này được điền tự động
// trong admin-config.mjs ngay sau khi admin lưu đúng Company API key +
// Company ID (gọi 1 lần API "list experiences" của Whop), không cần admin tự
// dán Experience ID.
export async function getTenantIdByExperienceId(experienceId) {
  if (!experienceId) return null;
  const store = pointsStore();
  try {
    const tenantId = await store.get(tenantKey("tenant-by-experience", experienceId));
    return tenantId || null;
  } catch (_) {
    return null;
  }
}

export async function linkExperienceToTenant(experienceId, tenantId) {
  if (!experienceId || !tenantId) return;
  const store = pointsStore();
  try { await store.set(tenantKey("tenant-by-experience", experienceId), tenantId); } catch (_) {}
}

export async function isPaidTier(companyId, tenantCfg) {
  if (!companyId) return false;
  const cfg = tenantCfg || (await getTenantConfig(companyId));
  if (cfg.unlockAllFeatures) return true;
  const store = pointsStore();
  try {
    const tier = await store.get(tenantKey("tenant-tier", companyId));
    return tier === "paid";
  } catch (_) {
    return false;
  }
}

export async function setTenantTier(companyId, tier) {
  if (!["free", "paid"].includes(tier)) throw new Error('tier phải là "free" hoặc "paid".');
  const store = pointsStore();
  await store.set(tenantKey("tenant-tier", companyId), tier);
}

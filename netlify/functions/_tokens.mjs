import { getTenantConfig } from "./_tenant.mjs";

// ĐÃ ĐỔI: trước đây mỗi tenant phải tự dán Company API key riêng (apik_...)
// qua trang Settings — admin hay tích sai quyền/dán nhầm. Giờ dùng đúng 1
// "App API key" DUY NHẤT của chính app này (lấy 1 lần ở Developer dashboard
// -> App details -> Environment variables -> WHOP_API_KEY, set vào Netlify
// env var WHOP_APP_API_KEY) — key này gọi được API thay mặt MỌI company đã
// bấm "Approve" cài app, chỉ cần thêm ?company_id=biz_xxx vào mỗi request
// (xem getHeaders() đã verify trong @whop/api). Dữ liệu trả về giống 100%
// cách cũ — chỉ khác cách xin phép (1 màn hình Approve, không cần admin tự
// tạo/dán/tích quyền key tay nữa).
export async function getCompanyAccessToken(companyId) {
  if (!companyId) throw new Error("getCompanyAccessToken: thiếu companyId.");
  const appApiKey = process.env.WHOP_APP_API_KEY;
  if (!appApiKey) {
    throw new Error(
      "Server chưa cấu hình WHOP_APP_API_KEY. Vào Whop Developer dashboard -> App details -> Environment variables để lấy key, set vào Netlify env var WHOP_APP_API_KEY."
    );
  }
  return appApiKey;
}

// Company ID THẬT (biz_xxx) của tenant — cần truyền vào mọi request REST API
// dạng ?company_id=... khi dùng App API key (key chung, không tự scope theo
// company như Company API key cũ).
export async function getRealCompanyId(companyId, tenantCfg) {
  const cfg = tenantCfg || (await getTenantConfig(companyId));
  const raw = cfg.whopCompanyId || companyId;
  // Tenant cũ có thể còn lưu giá trị bẩn (admin lỡ dán cả URL dài thời còn
  // dán tay) — tự lọc lại đúng "biz_xxx" mỗi lần đọc, không chỉ lúc lưu.
  const m = String(raw).match(/biz_[A-Za-z0-9]+/);
  return m ? m[0] : raw;
}

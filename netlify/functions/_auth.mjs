import { verifyUserToken } from "@whop/api";
import { getTenantIdByRealCompanyId, getTenantIdByExperienceId } from "./_tenant.mjs";

// App ID của CHÍNH app này (đăng ký trên dev.whop.com) — dùng để verify user
// token. KHÔNG còn dùng app API key để xin access token company-scoped nữa
// (xem _tokens.mjs — đã đổi sang dùng key admin tự dán per-tenant).
const APP_ID = process.env.WHOP_APP_ID || process.env.NEXT_PUBLIC_WHOP_APP_ID;

// ĐÃ XÁC MINH bằng cách đọc trực tiếp type definitions của package @whop/api
// (KHÔNG phải method trên object trả về từ WhopServerSdk(...) như docs ví dụ
// — bản 0.0.23 thực tế export verifyUserToken là 1 hàm RIÊNG, nhận trực tiếp
// token/Headers/Request làm tham số đầu, kèm { appId, dontThrow }):
//   verifyUserToken(tokenOrHeadersOrRequest, { appId, dontThrow }) -> { userId, appId } | null
export let lastVerifyError = null;
async function verifyUser(event) {
  const h = event.headers || {};
  const token = h["x-whop-user-token"] || h["X-Whop-User-Token"];
  if (!token) { lastVerifyError = "no-token-header"; return null; }
  try {
    const res = await verifyUserToken(new Headers(h), { appId: APP_ID, dontThrow: true });
    lastVerifyError = res ? null : "verifyUserToken returned null (invalid or expired token)";
    return res?.userId || null;
  } catch (e) {
    lastVerifyError = e?.message || String(e);
    return null;
  }
}

// ĐÃ XÁC MINH thực tế (test trong Whop thật, cả Experience View và Dashboard
// View): token JWT của Whop KHÔNG mang companyId/experienceId — chỉ có
// {sub: userId, iss, aud: appId}. Query string cũng không có gì (Whop không
// gắn experienceId/companyId vào URL). Tín hiệu ổn định duy nhất bắt được là
// header `referer`, dạng `https://<install-id>.apps.whop.com/...` — domain
// con này là mã định danh RIÊNG, ỔN ĐỊNH cho mỗi lượt cài app (test cả 2 ngữ
// cảnh đều ra cùng 1 subdomain). Dùng subdomain này làm "tenantId" thay cho
// companyId thật của Whop — không cần Whop cung cấp companyId nữa.
function resolveTenantIdFromReferer(event) {
  const h = event.headers || {};
  const referer = h["referer"] || h["Referer"] || "";
  const m = referer.match(/^https?:\/\/([a-z0-9]+)\.apps\.whop\.com/i);
  return m ? m[1] : null;
}

// ĐÃ SỬA (phát hiện lỗi nghiêm trọng: nhiều business khác nhau bị tính lẫn
// vào CÙNG 1 tenant vì subdomain referer KHÔNG khác nhau theo từng lượt cài
// app — test thật cho thấy 2 company khác nhau ra CÙNG 1 subdomain). Whop
// thực ra CÓ truyền đúng companyId/experienceId thật, nhưng qua URL của
// trang (Dashboard View: .../dashboard/[companyId], Experience View:
// .../experiences/[experienceId] — xem netlify.toml đã thêm redirect chuyển
// 2 dạng URL này thành query string ?companyId=...&?experienceId=...).
//
// Dashboard View (trang admin): companyId nhận được là company_id THẬT
// (biz_xxx) — dùng thẳng làm tenantId, ngoại trừ tenant CŨ đã từng lưu config
// dưới tenantId giả (referer cũ) thì tra qua getTenantIdByRealCompanyId để
// giữ nguyên data cũ, không mất.
//
// Experience View (trang member): chỉ nhận được experienceId (exp_xxx),
// KHÔNG có companyId — phải tra qua bảng "tenant-by-experience" (điền tự
// động bởi admin-config.mjs ngay sau khi admin lưu Company API key/ID).
async function resolveCompanyId(event) {
  const q = event.queryStringParameters || {};
  if (q.companyId) {
    const existing = await getTenantIdByRealCompanyId(q.companyId);
    return existing || q.companyId;
  }
  if (q.experienceId) {
    const tenantId = await getTenantIdByExperienceId(q.experienceId);
    if (tenantId) return tenantId;
  }
  // Fallback cho link cũ/trường hợp Whop chưa cấu hình lại path — vẫn hoạt
  // động như trước (có rủi ro nhầm tenant đã biết), tốt hơn là lỗi cứng.
  return resolveTenantIdFromReferer(event);
}

// Trả { userId, companyId }. Xem resolveCompanyId() ngay trên để biết
// companyId thật ra suy từ đâu.
export async function getAuthContext(event) {
  const userId = await verifyUser(event);
  const companyId = await resolveCompanyId(event);
  return { userId, companyId };
}

// Giữ lại cho code cũ/đơn giản chỉ cần userId (không cần biết tenant).
export async function getUserId(event) {
  return verifyUser(event);
}

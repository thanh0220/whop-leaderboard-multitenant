import { WhopServerSdk } from "@whop/api";

// App API key của CHÍNH app này (đăng ký trên dev.whop.com) — dùng để verify
// user token. KHÔNG còn dùng để xin access token company-scoped nữa (xem
// _tokens.mjs — đã đổi sang dùng key admin tự dán per-tenant).
const APP_ID = process.env.WHOP_APP_ID || process.env.NEXT_PUBLIC_WHOP_APP_ID;
const APP_API_KEY = process.env.WHOP_APP_API_KEY;

const whop = WhopServerSdk({ appId: APP_ID, appApiKey: APP_API_KEY });

// Xác thực token Whop gắn trong iframe, trả userId hoặc null.
// lastVerifyError lưu lỗi thật của lần verify gần nhất (kể cả khi trả null)
// để debug endpoint soi được nguyên nhân thật — trước đây lỗi bị nuốt mất.
export let lastVerifyError = null;
async function verifyUser(event) {
  const h = event.headers || {};
  const token = h["x-whop-user-token"] || h["X-Whop-User-Token"];
  if (!token) { lastVerifyError = "no-token-header"; return null; }
  try {
    const res = await whop.verifyUserToken(new Headers(h));
    lastVerifyError = null;
    return res?.userId || res?.user_id || null;
  } catch (e1) {
    try {
      const res = await whop.verifyUserToken(token);
      lastVerifyError = null;
      return res?.userId || res?.user_id || null;
    } catch (e2) {
      lastVerifyError = `attempt1: ${e1?.message || e1}; attempt2: ${e2?.message || e2}`;
      return null;
    }
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

// Trả { userId, companyId }. companyId ở đây thực chất là "tenantId" suy ra
// từ subdomain cài app (xem trên) — KHÔNG phải company_id thật dạng biz_xxx
// của Whop. Để gọi API Whop lấy dữ liệu thành viên/thanh toán thật, admin của
// từng tenant phải tự dán Company API key + Company ID thật của họ qua trang
// Settings (xem admin-config.mjs) — _tokens.mjs sẽ đọc giá trị đó.
export async function getAuthContext(event) {
  const userId = await verifyUser(event);
  const companyId = resolveTenantIdFromReferer(event);
  return { userId, companyId };
}

// Giữ lại cho code cũ/đơn giản chỉ cần userId (không cần biết tenant).
export async function getUserId(event) {
  return verifyUser(event);
}

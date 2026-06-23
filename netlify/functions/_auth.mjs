import { WhopServerSdk } from "@whop/api";
import { pointsStore, tenantKey } from "./_store.mjs";

// App API key của CHÍNH app này (đăng ký trên dev.whop.com) — không phải key
// riêng của từng business cài app. Dùng để verify token + xin access token
// company-scoped (xem _tokens.mjs).
const APP_ID = process.env.WHOP_APP_ID || process.env.NEXT_PUBLIC_WHOP_APP_ID;
const APP_API_KEY = process.env.WHOP_APP_API_KEY;

const whop = WhopServerSdk({ appId: APP_ID, appApiKey: APP_API_KEY });

// Xác thực token Whop gắn trong iframe, trả userId hoặc null.
async function verifyUser(event) {
  const h = event.headers || {};
  const token = h["x-whop-user-token"] || h["X-Whop-User-Token"];
  if (!token) return null;
  try {
    const res = await whop.verifyUserToken(new Headers(h));
    return res?.userId || res?.user_id || null;
  } catch (_) {
    try {
      const res = await whop.verifyUserToken(token);
      return res?.userId || res?.user_id || null;
    } catch (_e) {
      return null;
    }
  }
}

// Resolve companyId từ experienceId (Experience View), cache lại trong Blobs
// vì 1 experience luôn thuộc về đúng 1 company suốt vòng đời cài app.
//
// ⚠️ CHƯA XÁC MINH với Whop thật: cơ chế chính xác @whop/api dùng để map
// experienceId -> companyId. Dùng tạm endpoint `/v5/experiences/{id}` theo suy
// đoán hợp lý từ docs công khai — PHẢI kiểm tra lại bằng _debug.mjs khi app đã
// đăng ký thật trên dev.whop.com và chạy thử trong 1 Whop business thật
// (xem Phase 1 trong file kế hoạch).
async function resolveCompanyFromExperience(experienceId) {
  if (!experienceId) return null;
  const store = pointsStore();
  const cacheKey = tenantKey("exp-company", experienceId);
  try {
    const cached = await store.get(cacheKey);
    if (cached) return cached;
  } catch (_) {}

  try {
    const r = await fetch(`https://api.whop.com/api/v5/experiences/${experienceId}`, {
      headers: { Authorization: `Bearer ${APP_API_KEY}` },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const companyId = j.company_id || j.company?.id || null;
    if (companyId) await store.set(cacheKey, companyId);
    return companyId;
  } catch (_) {
    return null;
  }
}

// Trả { userId, companyId, experienceId }. Bất kỳ field nào không resolve
// được sẽ là null — caller tự quyết định trả lỗi gì cho phù hợp.
//
// Cách resolve companyId, theo 2 kiểu nhúng app của Whop:
//  - Experience View (trang member dùng): client gửi kèm ?experienceId=exp_xxx
//    trên mọi fetch (frontend đã được sửa để làm điều này — xem public/*.html).
//  - Dashboard View (trang admin business dùng): Whop cấp company_id trực tiếp,
//    client gửi kèm ?companyId=biz_xxx.
export async function getAuthContext(event) {
  const userId = await verifyUser(event);
  const qs = event.queryStringParameters || {};

  let companyId = qs.companyId || null;
  const experienceId = qs.experienceId || null;

  if (!companyId && experienceId) {
    companyId = await resolveCompanyFromExperience(experienceId);
  }

  return { userId, companyId, experienceId };
}

// Giữ lại cho code cũ/đơn giản chỉ cần userId (không cần biết tenant).
export async function getUserId(event) {
  return verifyUser(event);
}

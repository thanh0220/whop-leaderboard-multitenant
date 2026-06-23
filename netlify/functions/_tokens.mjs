import { pointsStore, tenantKey } from "./_store.mjs";

const APP_API_KEY = process.env.WHOP_APP_API_KEY;

// App chỉ có 1 API key cấp app (không phải key riêng từng business). Để gọi
// API Whop thay mặt 1 business cụ thể đã cài app, phải xin 1 access token
// ngắn hạn scoped theo companyId đó qua endpoint /access_tokens.
//
// ⚠️ CHƯA XÁC MINH: path/body chính xác của endpoint này (docs công khai chỉ
// mô tả khái niệm, không cho schema request/response đầy đủ). Bản dưới đây là
// suy đoán hợp lý nhất theo mô tả "POST kèm company_id, trả JWT ngắn hạn".
// PHẢI xác minh lại bằng cách đọc type definitions của package @whop/api đã
// cài (rất có thể SDK có sẵn 1 method wrapper, ví dụ
// `whop.companies.getAccessToken({ companyId })`, thay cho fetch thủ công ở
// đây) — việc này nằm trong checklist xác minh Phase 1.
async function mintAccessToken(companyId) {
  const r = await fetch("https://api.whop.com/api/v5/access_tokens", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${APP_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ company_id: companyId }),
  });
  if (!r.ok) {
    throw new Error(`Không xin được access token cho company ${companyId}: HTTP ${r.status}`);
  }
  const j = await r.json();
  const token = j.token || j.access_token || j.jwt;
  // Hết hạn 1-3h theo docs — nếu API không trả expires_at rõ, an toàn coi như 50 phút.
  const expiresAt = j.expires_at
    ? new Date(j.expires_at).getTime()
    : Date.now() + 50 * 60 * 1000;
  if (!token) throw new Error("Phản hồi /access_tokens không có token.");
  return { token, expiresAt };
}

// Trả 1 access token còn hạn cho companyId, tự cache trong Blobs và tự xin
// mới khi hết hạn (chừa 5 phút an toàn).
export async function getCompanyAccessToken(companyId) {
  if (!companyId) throw new Error("getCompanyAccessToken: thiếu companyId.");
  const store = pointsStore();
  const key = tenantKey("access-token", companyId);

  try {
    const cached = await store.get(key, { type: "json" });
    if (cached && cached.token && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
      return cached.token;
    }
  } catch (_) {}

  const fresh = await mintAccessToken(companyId);
  try { await store.setJSON(key, fresh); } catch (_) {}
  return fresh.token;
}

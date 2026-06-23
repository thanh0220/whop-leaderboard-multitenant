import { getTenantConfig } from "./_tenant.mjs";

// Trả Company API key (do admin của tenant tự dán qua trang Settings — xem
// admin-config.mjs) để gọi Whop REST API thay mặt business đó.
//
// Đã bỏ cách cũ "xin access token ngắn hạn qua /access_tokens" vì test thực
// tế cho thấy token Whop cấp cho app không mang companyId — không có cách
// nào suy ra company cần xin token cho. Quay về đúng mô hình app cũ đã chạy
// được: mỗi tenant tự dán Company API key của chính họ (apik_...), giống
// WHOP_API_KEY trước đây nhưng theo từng tenant.
export async function getCompanyAccessToken(companyId) {
  if (!companyId) throw new Error("getCompanyAccessToken: thiếu companyId.");
  const cfg = await getTenantConfig(companyId);
  if (!cfg.whopApiKey) {
    throw new Error(
      "Community này chưa cấu hình Whop API key. Admin hãy vào trang Settings của app để dán Company API key."
    );
  }
  return cfg.whopApiKey;
}

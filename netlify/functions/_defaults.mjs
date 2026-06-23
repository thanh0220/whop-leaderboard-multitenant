// Cấu hình mặc định cho 1 tenant (business) MỚI cài app — generic, KHÔNG chứa
// dữ liệu/brand riêng của bất kỳ business nào (không link Drive, không
// Calendly, không ảnh brand). Mỗi business tự thêm phần thưởng riêng của họ
// qua trang admin (Dashboard View — xem _tenant.mjs + admin-config.mjs).
export const DEFAULT_TENANT = {
  // Admin của tenant tự dán qua trang Settings (admin-config.mjs). Whop
  // không cấp companyId cho app theo cách tự động — đây là Company API key
  // (apik_...) + Company ID (biz_...) thật của business đó, lấy từ chính
  // Whop của họ. KHÔNG BAO GIỜ trả 2 field này ra response cho trang member.
  whopApiKey: null,
  whopCompanyId: null,
  // "Mật khẩu" đơn giản để khoá trang Settings — người đầu tiên cấu hình đặt
  // setupSecret này, lần sửa sau phải nhập đúng mới được. Đây là giải pháp
  // tạm cho tới khi xác minh được cách gọi checkAccess() chuẩn của Whop SDK
  // để gate theo đúng quyền admin thật trong Whop.
  setupSecret: null,
  // Khi true: bỏ qua paywall freemium hoàn toàn cho tenant này — dùng trong
  // giai đoạn build/test CMS admin, KHÔNG xoá logic gate thật ở isPaidTier()
  // (_tenant.mjs) — chỉ OR thêm điều kiện này. Tắt (false) khi có billing
  // thật (Phase 5 trong kế hoạch).
  unlockAllFeatures: true,
  branding: {
    displayName: "Your Community",
    primaryColor: "#7c3aed",
    logoUrl: null,
  },
  points: {
    perUsd: 1,
    perMonth: 2,
    maxMonths: 12,
    referralPct: 0.5,
    referralFlat: 5,
    referralCap: 100,
    perReferral: 0,
  },
  fx: { usd: 1, vnd: 1 / 25000, eur: 1.08, gbp: 1.27, aud: 0.66, cad: 0.73 },
  checkinRewards: [
    2, 3, 5, 7, 10,
    15, 20, 10, 10, 25,
    10, 10, 10, 50, 10,
    10, 10, 10, 10, 75,
    10, 10, 10, 10, 10,
    10, 10, 10, 10, 200,
  ],
  dailyQuests: [
    { id: "visit",  name: "Visit the app today",       reward: 1, icon: "👋" },
    { id: "share",  name: "Share your referral link",  reward: 5, icon: "🔗" },
    { id: "engage", name: "Comment or react to a post", reward: 3, icon: "💬" },
  ],
  seasonTopRewards: [
    { rank: "🥇 Top 1", prize: "2,000 pts" },
    { rank: "🥈 Top 2", prize: "1,000 pts" },
    { rank: "🥉 Top 3", prize: "600 pts" },
    { rank: "🏅 Top 4", prize: "400 pts" },
    { rank: "🏅 Top 5", prize: "250 pts" },
    { rank: "🏅 Top 6", prize: "150 pts" },
  ],
  // Rỗng có chủ đích: rewards/redeemCodes là sản phẩm của TỪNG business, không
  // được ship sẵn sản phẩm của 1 business cụ thể cho mọi tenant khác.
  rewards: [],
  redeemCodes: {},
  // Rương Liên Minh: khi 1 member mua hàng thật trên Whop (webhook
  // payment_succeeded — xem webhook.mjs), TOÀN BỘ member khác trong kênh
  // nhận 1 rương. Tier chọn theo số tiền USD của giao dịch (đã đổi qua `fx`).
  chestRules: {
    thresholds: [
      { tier: "wood",   label: "Rương Gỗ",   icon: "🟫", minUsd: 0 },
      { tier: "silver", label: "Rương Bạc",  icon: "⬜", minUsd: 20 },
      { tier: "gold",   label: "Rương Vàng", icon: "🟨", minUsd: 100 },
    ],
    rewardRange: {
      wood:   { min: 5,   max: 15 },
      silver: { min: 20,  max: 50 },
      gold:   { min: 100, max: 300 },
    },
    expiryHours: 48,
  },
};

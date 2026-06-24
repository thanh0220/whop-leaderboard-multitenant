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
  // Khi true: bỏ qua paywall freemium hoàn toàn cho tenant này — dùng cho
  // support/comp account (set bằng tay, xem admin-set-tier.mjs), KHÔNG xoá
  // logic gate thật ở isPaidTier() (_tenant.mjs) — chỉ OR thêm điều kiện này.
  // Default false từ khi có billing thật — tenant CŨ đã lưu true từ trước vẫn
  // giữ nguyên (deepMerge ưu tiên giá trị đã lưu), chỉ tenant MỚI nhận false.
  unlockAllFeatures: false,
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
  // Công tắc bật/tắt riêng cho Redeem Codes — field RIÊNG (không nhồi vào
  // trong redeemCodes, vì đó là map động code->reward, nhồi "enabled" vào sẽ
  // đụng với 1 code thật tên "enabled"). deepMerge ở _tenant.mjs tự thêm field
  // này cho tenant cũ (chưa từng lưu) mà không cần migration riêng.
  codesEnabled: true,
  // Lịch sự kiện độc lập (live stream, khuyến mãi, AMA, bảo trì...) — KHÔNG
  // gắn với Nhiệm vụ/Code, chỉ để thông báo/hiển thị trên public/events.html.
  // 2 ô mặc định (khớp giới hạn Free) — admin tự thêm/xoá ô qua admin.html,
  // tối đa 2 (Free) / 10 (Paid) — xem events.mjs + admin-config.mjs.
  events: [
    { id: "event_1", name: "Event 1", image: "", date: "" },
    { id: "event_2", name: "Event 2", image: "", date: "" },
  ],
  eventsEnabled: true,
  // Rương Liên Minh: khi 1 member mua hàng thật trên Whop (webhook
  // payment_succeeded — xem webhook.mjs), TOÀN BỘ member khác trong kênh
  // nhận 1 rương. Tier chọn theo số tiền USD của giao dịch (đã đổi qua `fx`).
  chestRules: {
    enabled: true,
    thresholds: [
      { tier: "wood",   label: "Wood Chest",   icon: "🟫", minUsd: 0 },
      { tier: "silver", label: "Silver Chest", icon: "⬜", minUsd: 20 },
      { tier: "gold",   label: "Gold Chest",   icon: "🟨", minUsd: 100 },
    ],
    rewardRange: {
      wood:   { min: 5,   max: 15 },
      silver: { min: 20,  max: 50 },
      gold:   { min: 100, max: 300 },
    },
    // Rương riêng phát thẳng cho CHÍNH người vừa mua hàng (ngoài rương cộng
    // đồng ở trên) — đảm bảo có, khoảng xu cao hơn rõ rệt — củng cố ngay lúc
    // họ dễ refund nhất (vừa trả tiền) rằng quyết định mua là đúng.
    buyerReward: { min: 80, max: 200 },
    expiryHours: 48,
  },
  // Nạp lũy kế: member tự cộng dồn USD đã nạp THẬT trong 1 kỳ (periodDays),
  // đạt mốc (thresholdUsd) thì claim quà — ưu tiên giao 1 reward có sẵn trong
  // `rewards` (rewardId) nếu admin gắn, không thì thưởng thẳng xu khai báo
  // trên tier. Mặc định tắt vì cần admin tự đặt mốc trước khi bật.
  milestoneRules: {
    enabled: false,
    periodDays: 7,
    tiers: [
      { thresholdUsd: 5,   rewardId: null, xu: 50,   label: "Starter Reward", icon: "🎁" },
      { thresholdUsd: 10,  rewardId: null, xu: 150,  label: "Bronze Reward",  icon: "🎁" },
      { thresholdUsd: 20,  rewardId: null, xu: 400,  label: "Silver Reward",  icon: "🎁" },
      { thresholdUsd: 50,  rewardId: null, xu: 900,  label: "Gold Reward",    icon: "🎁" },
      { thresholdUsd: 100, rewardId: null, xu: 2000, label: "Diamond Reward", icon: "🎁" },
    ],
  },
};

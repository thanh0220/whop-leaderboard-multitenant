// Cấu hình mặc định cho 1 tenant (business) MỚI cài app — generic, KHÔNG chứa
// dữ liệu/brand riêng của bất kỳ business nào (không link Drive, không
// Calendly, không ảnh brand). Mỗi business tự thêm phần thưởng riêng của họ
// qua trang admin (Dashboard View — xem _tenant.mjs + admin-config.mjs).
export const DEFAULT_TENANT = {
  // ĐÃ ĐỔI: không còn admin tự dán Company API key nữa — dùng 1 App API key
  // chung (process.env.WHOP_APP_API_KEY, xem _tokens.mjs). whopApiKey giữ lại
  // CHỈ để tương thích ngược với tenant cũ đã lưu (không xoá DB), KHÔNG còn
  // được ghi mới. whopCompanyId: company_id THẬT (biz_...) — với tenant MỚI,
  // companyId (tenantId nội bộ) đã chính là biz_... thật nên field này có thể
  // null (xem getRealCompanyId() trong _tokens.mjs tự fallback) — chỉ tenant
  // CŨ (migrate từ referer cũ) mới cần giá trị này. KHÔNG BAO GIỜ trả 2 field
  // này ra response cho trang member.
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
  checkinMilestoneDays: [5, 10, 15, 20, 30],
  checkinMilestoneBonus: [],
  seasonVipTopRewards: [
    { rank: "🥇 Top 1", prize: "2,000 XU", xu: 2000 },
    { rank: "🥈 Top 2", prize: "1,000 XU", xu: 1000 },
    { rank: "🥉 Top 3", prize: "600 XU", xu: 600 },
    { rank: "🏅 Top 4", prize: "400 XU", xu: 400 },
    { rank: "🏅 Top 5", prize: "250 XU", xu: 250 },
    { rank: "🏅 Top 6", prize: "150 XU", xu: 150 },
  ],
  seasonRefTopRewards: [
    { rank: "🥇 Top 1", prize: "1,500 XU", xu: 1500 },
    { rank: "🥈 Top 2", prize: "800 XU",   xu: 800  },
    { rank: "🥉 Top 3", prize: "400 XU",   xu: 400  },
    { rank: "🏅 Top 4", prize: "200 XU",   xu: 200  },
    { rank: "🏅 Top 5", prize: "100 XU",   xu: 100  },
  ],
  dailyEnabled:   true,
  storeEnabled:   true,
  mailboxEnabled: true,
  rewards: [
    { id: 'reward_default_1', name: 'Basic Package',   cost: 5000,  desc: '', image: '', buttonLabel: 'BUY', tier: 1, payload: { kind: 'code', code: '' } },
    { id: 'reward_default_2', name: 'Premium Package', cost: 10000, desc: '', image: '', buttonLabel: 'BUY', tier: 1, payload: { kind: 'code', code: '' } },
    { id: 'reward_default_3', name: 'VIP Package',     cost: 15000, desc: '', image: '', buttonLabel: 'BUY', tier: 1, payload: { kind: 'code', code: '' } },
  ],

  redeemCodes: {
    WELCOME: { xu: 100 },
  },
  // Công tắc bật/tắt riêng cho Redeem Codes — field RIÊNG (không nhồi vào
  // trong redeemCodes, vì đó là map động code->reward, nhồi "enabled" vào sẽ
  // đụng với 1 code thật tên "enabled"). deepMerge ở _tenant.mjs tự thêm field
  // này cho tenant cũ (chưa từng lưu) mà không cần migration riêng.
  codesEnabled: true,
  // Event calendar default slots — admin drags unscheduled chips onto the calendar.
  events: [
    { id: "event_3", name: "📣 New Event", image: "", date: "", endDate: "", desc: "Edit the name and drag onto the calendar to schedule." },
  ],
  eventsEnabled: true,
  // Wizard setup đã hoàn thành chưa — false với tenant mới, true sau khi click
  // "Launch!" hoặc "Skip setup". Admin.html dùng để quyết định có hiện wizard không.
  onboardingCompleted: false,
  // Weekly digest email — opt-in thủ công (default tắt, tránh spam).
  digestEnabled: false,
  digestEmail: "",
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
  // Mốc theo SỐ LƯỢT GIỚI THIỆU (referral, tính LIFETIME — dùng đúng số
  // `referrals` đã tính ở computeEarned(), giống Leaderboard/Store), đạt mốc
  // (thresholdReferrals) thì claim quà — ưu tiên giao 1 reward có sẵn trong
  // `rewards` (rewardId) nếu admin gắn, hoặc vé Lucky Spin (rewardId="__spin__"
  // + spinTickets), không thì thưởng thẳng xu khai báo trên tier. Mặc định tắt
  // vì cần admin tự đặt mốc trước khi bật.
  milestoneRules: {
    enabled: false,
    tiers: [
      { thresholdReferrals: 1,  rewardId: null, xu: 50,  label: "Starter Reward", icon: "🎁" },
      { thresholdReferrals: 3,  rewardId: null, xu: 150, label: "Bronze Reward",  icon: "🎁" },
      { thresholdReferrals: 5,  rewardId: null, xu: 400, label: "Silver Reward",  icon: "🎁" },
      { thresholdReferrals: 10, rewardId: null, xu: 900, label: "Gold Reward",    icon: "🎁" },
    ],
  },
  // Chatbot display name — shown as sender in Whop Support Chat (agent_name field)
  chatbotName: "Support Bot",
  // Enable chatbot-poller scheduled function (polls every 2 min for button replies)
  chatbotEnabled: false,
  // Enable drip sequence engine (runs daily via drip.mjs scheduled function)
  dripEnabled: false,
  // Drip sequences config — array of sequences, each with steps
  // Each step: { message, delayDays, options?, imageUrl? }
  dripSequences: [],
  // Auto promo code on streak milestone (requires promo_code:create permission in Whop)
  promoRewards: {
    enabled: false,
    milestones: [
      { streakDays: 7,  discountPct: 10 },
      { streakDays: 14, discountPct: 15 },
      { streakDays: 30, discountPct: 20 },
    ],
  },
};

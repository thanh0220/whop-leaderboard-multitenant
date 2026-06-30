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
  seasonTopRewards: [
    { rank: "🥇 Top 1", prize: "2,000 pts" },
    { rank: "🥈 Top 2", prize: "1,000 pts" },
    { rank: "🥉 Top 3", prize: "600 pts" },
    { rank: "🏅 Top 4", prize: "400 pts" },
    { rank: "🏅 Top 5", prize: "250 pts" },
    { rank: "🏅 Top 6", prize: "150 pts" },
  ],
  dailyEnabled:   true,
  storeEnabled:   true,
  mailboxEnabled: true,
  // Rỗng có chủ đích: rewards là sản phẩm của TỪNG business, không ship sẵn
  // sản phẩm của 1 business cụ thể cho mọi tenant khác. store.html tự hiện
  // "no rewards yet" khi mảng rỗng — sạch, không gây nhầm lẫn cho member.
  rewards: [],
  // Catalog sản phẩm dành riêng cho Auction — KHÔNG liên quan Store.
  // Chủ whop tự thêm/xoá qua Admin > Auction. Mặc định 1 sản phẩm mẫu đẹp.
  auctionProducts: [
    {
      id: "auction_default_1",
      name: "🏆 VIP Membership — 1 Month",
      image: "/auction-default.svg",
      desc: "1-month VIP membership — exclusive content access, priority support, and more.",
    },
  ],
  redeemCodes: {
    WELCOME: { xu: 100 },
  },
  // Công tắc bật/tắt riêng cho Redeem Codes — field RIÊNG (không nhồi vào
  // trong redeemCodes, vì đó là map động code->reward, nhồi "enabled" vào sẽ
  // đụng với 1 code thật tên "enabled"). deepMerge ở _tenant.mjs tự thêm field
  // này cho tenant cũ (chưa từng lưu) mà không cần migration riêng.
  codesEnabled: true,
  // Event calendar — 3 default slots (Free plan limit).
  // event_1/event_2 use recurringDays (auto-show every week, no date needed).
  // event_3 is unscheduled — admin drags it onto the calendar to set a date.
  events: [
    { id: "event_1", name: "🎰 Lucky Spin",  image: "", recurringDays: [1,2,3,4], desc: "Spin the wheel to win XU and prizes! Every Monday to Thursday." },
    { id: "event_2", name: "🔨 Auction",     image: "", recurringDays: [5,6,0],   desc: "Bid your XU to win exclusive items! Every Friday to Sunday." },
    { id: "event_3", name: "📣 New Event",   image: "", date: "",  endDate: "",   desc: "Edit the name and drag onto the calendar to schedule." },
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
  // Mốc theo SỐ LƯỢT GIỚI THIỆU (referral, tính LIFETIME — dùng đúng số
  // `referrals` đã tính ở computeEarned(), giống Leaderboard/Store), đạt mốc
  // (thresholdReferrals) thì claim quà — ưu tiên giao 1 reward có sẵn trong
  // `rewards` (rewardId) nếu admin gắn, hoặc vé Lucky Spin (rewardId="__spin__"
  // + spinTickets), không thì thưởng thẳng xu khai báo trên tier. Mặc định tắt
  // vì cần admin tự đặt mốc trước khi bật.
  milestoneRules: {
    enabled: false,
    tiers: [
      { thresholdReferrals: 1,  rewardId: null, xu: 50,   label: "Starter Reward", icon: "🎁" },
      { thresholdReferrals: 3,  rewardId: null, xu: 150,  label: "Bronze Reward",  icon: "🎁" },
      { thresholdReferrals: 5,  rewardId: null, xu: 400,  label: "Silver Reward",  icon: "🎁" },
      { thresholdReferrals: 10, rewardId: null, xu: 900,  label: "Gold Reward",    icon: "🎁" },
      { thresholdReferrals: 20, rewardId: null, xu: 2000, label: "Diamond Reward", icon: "🎁" },
    ],
  },
  // Lucky Spin: thanh toán THẬT tự động cộng vé quay (ticketsPerPayment, flat
  // mỗi lần thanh toán) — member cũng có thể đổi vé bằng xu (xuCostPerTicket,
  // cố ý đặt đắt để ưu tiên đường nạp tiền thật). Quay random có trọng số
  // (weight) trong `prizes`, giao thưởng tự động (item Reward Store MIỄN PHÍ
  // nếu gắn rewardId, không thì cộng thẳng xu) — không cần admin động tay.
  spinRules: {
    enabled: true,
    ticketsPerPayment: 5,
    xuCostPerTicket: 500,
    prizes: [
      { id: "p1", label: "Small Win",  weight: 50, rewardId: null, xu: 20 },
      { id: "p2", label: "Medium Win", weight: 30, rewardId: null, xu: 80 },
      { id: "p3", label: "Big Win",    weight: 15, rewardId: null, xu: 300 },
      { id: "p4", label: "Jackpot",    weight: 5,  rewardId: null, xu: 1000 },
    ],
  },
  // Auction House: 1 vật phẩm DUY NHẤT (admin chọn 1 item có sẵn trong
  // Reward Store qua rewardId) đem ra đấu giá bằng xu. Đây chỉ là CẤU HÌNH —
  // state phiên đấu giá đang chạy (giá cao nhất, lịch sử bid, hạn chốt) lưu
  // riêng ở blob "auction-state:<tenantId>", KHÔNG nằm trong config này, vì
  // mỗi lần admin bấm "Start New Auction" sẽ tạo state mới — xem auction.mjs.
  auctionRules: {
    enabled: false,
    rewardId: "auction_default_1",
    startingBid: 5000,
    minIncrement: 100,
    durationHours: 48,
  },
};

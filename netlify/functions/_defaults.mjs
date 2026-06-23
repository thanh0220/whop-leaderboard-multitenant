// Cấu hình mặc định cho 1 tenant (business) MỚI cài app — generic, KHÔNG chứa
// dữ liệu/brand riêng của bất kỳ business nào (không link Drive, không
// Calendly, không ảnh brand). Mỗi business tự thêm phần thưởng riêng của họ
// qua trang admin (Dashboard View — xem _tenant.mjs + admin-config.mjs).
export const DEFAULT_TENANT = {
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
};

import { pointsStore, tenantKey } from "./_store.mjs";
import { getRealCompanyId } from "./_tokens.mjs";

const norm = (s) => String(s || "").toLowerCase().trim().replace(/\s+/g, "_");
const GOOD = ["paid", "succeeded", "completed", "success", "successful"];
const BAD = ["fail", "incomplete", "open", "draft", "void", "cancel", "expire",
  "refund", "dispute", "chargeback", "resolution_lost", "lost", "uncollect",
  "pending", "processing", "requires_"];

// Cache kết quả computeEarned (phần chậm nhất của me.mjs vì gọi nhiều API
// thật của Whop, phân trang tuần tự) theo (companyId, userId) trong vài phút —
// hầu hết các lần load trang sau đó chỉ cần đọc Blobs (nhanh) thay vì gọi lại
// Whop API. Số liệu vẫn cập nhật trong tối đa CACHE_TTL_MS sau khi user mua
// hàng/giới thiệu thật — đánh đổi hợp lý giữa tốc độ và độ mới.
const CACHE_TTL_MS = 4 * 60 * 1000;

export async function computeEarned(userId, apiKey, companyId, tenantCfg) {
  const store = pointsStore();
  const cacheKey = tenantKey("earned-cache", companyId, userId);

  let heavy = null;
  try {
    const cached = await store.get(cacheKey, { type: "json" });
    if (cached && typeof cached === "object" && Date.now() - cached.ts < CACHE_TTL_MS) {
      heavy = cached.data;
    }
  } catch (_) {}

  if (!heavy) {
    heavy = await computeEarnedUncached(userId, apiKey, companyId, tenantCfg);
    try { await store.setJSON(cacheKey, { ts: Date.now(), data: heavy }); } catch (_) {}
  }

  let bonus = 0;
  try {
    const b = await store.get(tenantKey("bonus", companyId, userId));
    if (b) bonus = Number(b) || 0;
  } catch (_) {}

  return {
    earned: heavy.core + bonus,
    paidUsd: heavy.paidUsd,
    referrals: heavy.referrals,
    referralUsd: heavy.referralUsd,
    referralPoints: heavy.referralPoints,
    months: heavy.months,
    username: heavy.username || userId,
    bonus,
  };
}

// Tính xu KIẾM ĐƯỢC của 1 user trong 1 tenant cụ thể: từ tiền đã trả (thật) +
// đơn giới thiệu + thâm niên + xu thưởng (check-in/quest).
// apiKey ở đây là access token company-scoped (xem _tokens.mjs), không còn là
// 1 key tĩnh dùng chung cho mọi business như bản single-tenant cũ.
// tenantCfg.points / tenantCfg.fx thay cho POINTS/FX import cứng trước đây —
// mỗi business có thể chỉnh tỉ lệ kiếm xu riêng của họ qua trang admin.
async function computeEarnedUncached(userId, apiKey, companyId, tenantCfg) {
  const POINTS = tenantCfg.points;
  const FX = tenantCfg.fx;
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  const realCompanyId = await getRealCompanyId(companyId, tenantCfg);

  // 1) tổng tiền đã thanh toán thật của user (quy ~USD)
  let usd = 0;
  for (let page = 1; page <= 3; page++) {
    const r = await fetch(`https://api.whop.com/api/v1/payments?company_id=${realCompanyId}&page=${page}&per_page=100`, { headers });
    if (!r.ok) break;
    const j = await r.json();
    const arr = j.data || [];
    arr.forEach((p) => {
      const uid = p.user_id || (p.user && (typeof p.user === "object" ? p.user.id : p.user));
      if (uid !== userId) return;
      const amt = Number(p.final_amount ?? p.subtotal ?? p.amount ?? p.total ?? 0);
      const refunded = Number(p.refunded_amount ?? 0);
      const st = norm(p.status), sub = norm(p.substatus);
      const hasRefund = !!p.refunded_at || (refunded > 0 && refunded >= amt) || sub.includes("refund");
      const isBad = BAD.some((k) => st.includes(k) || sub.includes(k));
      const ok = amt > 0 && !hasRefund && !isBad && (GOOD.includes(st) || (!!p.paid_at && st === ""));
      if (ok) {
        const net = amt - (refunded > 0 ? refunded : 0);
        const cur = String(p.currency || "usd").toLowerCase();
        usd += net * (FX[cur] ?? 1);
      }
    });
    const tp = j.pagination && j.pagination.total_pages;
    if (!tp || page >= tp || arr.length === 0) break;
  }

  // 2) Đơn giới thiệu: cộng theo % giá trị đơn của người được giới thiệu
  //    (thay cho flat 50 xu/đơn — chống farm acc rác mua $0 hoặc đơn nhỏ).
  let referrals = 0;
  let referralUsd = 0;     // tổng USD các đơn mà user này giới thiệu được
  let referralPoints = 0;  // tổng xu referral đã tính (đã áp cap mỗi đơn)
  let firstJoinTs = null;
  let username = null;
  try {
    const ur = await fetch(`https://api.whop.com/api/v1/users/${userId}`, { headers });
    if (ur.ok) { const u = await ur.json(); username = u.username || u.name || null; }

    // Map user_id của các thành viên do user này giới thiệu
    const referredUserIds = new Set();
    for (let page = 1; page <= 3; page++) {
      const r = await fetch(`https://api.whop.com/api/v1/memberships?company_id=${realCompanyId}&page=${page}&per_page=100`, { headers });
      if (!r.ok) break;
      const j = await r.json();
      const arr = j.data || [];
      arr.forEach((m) => {
        const muid = m.user_id || (m.user && (typeof m.user === "object" ? m.user.id : m.user));
        if (username && m.affiliate_username === username) {
          referrals++;
          if (muid) referredUserIds.add(muid);
        }
        if (muid === userId && m.created_at) {
          // v1 memberships trả created_at dạng chuỗi ISO 8601 (đã xác nhận qua
          // docs Whop), không phải số giây unix như v5 cũ — dùng Date.parse
          // để xử lý đúng, tránh ra NaN.
          const ts = Date.parse(m.created_at);
          if (!isNaN(ts) && (firstJoinTs == null || ts < firstJoinTs)) firstJoinTs = ts;
        }
      });
      const tp = j.pagination && j.pagination.total_pages;
      if (!tp || page >= tp || arr.length === 0) break;
    }

    // Quét lại payments để cộng dồn USD các đơn THẬT của người được giới thiệu
    if (referredUserIds.size > 0) {
      for (let page = 1; page <= 3; page++) {
        const r = await fetch(`https://api.whop.com/api/v1/payments?company_id=${realCompanyId}&page=${page}&per_page=100`, { headers });
        if (!r.ok) break;
        const j = await r.json();
        const arr = j.data || [];
        arr.forEach((p) => {
          const uid = p.user_id || (p.user && (typeof p.user === "object" ? p.user.id : p.user));
          if (!referredUserIds.has(uid)) return;
          const amt = Number(p.final_amount ?? p.subtotal ?? p.amount ?? p.total ?? 0);
          const refunded = Number(p.refunded_amount ?? 0);
          const st = norm(p.status), sub = norm(p.substatus);
          const hasRefund = !!p.refunded_at || (refunded > 0 && refunded >= amt) || sub.includes("refund");
          const isBad = BAD.some((k) => st.includes(k) || sub.includes(k));
          const ok = amt > 0 && !hasRefund && !isBad && (GOOD.includes(st) || (!!p.paid_at && st === ""));
          if (ok) {
            const net = amt - (refunded > 0 ? refunded : 0);
            const cur = String(p.currency || "usd").toLowerCase();
            const orderUsd = net * (FX[cur] ?? 1);
            referralUsd += orderUsd;
            // Tính xu cho đơn này, áp cap mỗi đơn
            const raw = orderUsd * (POINTS.referralPct ?? 0) + (POINTS.referralFlat ?? 0);
            const capped = Math.min(raw, POINTS.referralCap ?? raw);
            referralPoints += capped;
          }
        });
        const tp = j.pagination && j.pagination.total_pages;
        if (!tp || page >= tp || arr.length === 0) break;
      }
    }
  } catch (_) {}

  // 3) thâm niên (tháng), tối đa MAX_MONTHS
  let months = 0;
  if (firstJoinTs) {
    const days = Math.floor((Date.now() - firstJoinTs) / (1000 * 60 * 60 * 24));
    months = Math.min(Math.floor(days / 30), POINTS.maxMonths ?? 12);
  }

  const core =
    Math.floor(usd * POINTS.perUsd) +
    Math.floor(referralPoints) +
    months * (POINTS.perMonth ?? 0);

  // "bonus" (xu từ check-in/quest/claim) KHÔNG nằm trong phần cache ở
  // computeEarned() bên dưới — nó đổi liên tục mỗi lần user bấm Claim nên
  // luôn phải đọc tươi, không được để dính cache TTL của phần gọi API Whop.
  return {
    core,
    paidUsd: Math.round(usd),
    referrals,
    referralUsd: Math.round(referralUsd),
    referralPoints: Math.floor(referralPoints),
    months,
    username,
  };
}

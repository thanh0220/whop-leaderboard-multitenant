import { getAuthContext } from "./_auth.mjs";
import { getCompanyAccessToken, getRealCompanyId } from "./_tokens.mjs";
import { getTenantConfig, isPaidTier, getTierLevel } from "./_tenant.mjs";

const WHOP_API = "https://api.whop.com/api/v5";

// ---- Helpers: bóc tên & avatar từ MỌI shape user mà Whop có thể trả về ----
function pickUsername(u) {
  if (!u || typeof u !== "object") return null;
  return (
    u.username ||
    u.name ||
    u.discord_username ||
    (u.email ? String(u.email).split("@")[0] : null) ||
    null
  );
}

function pickAvatar(u) {
  if (!u || typeof u !== "object") return null;
  return (
    (u.profile_picture && u.profile_picture.url) || // shape thật của Whop
    u.profile_pic_url ||
    u.avatar ||
    null
  );
}

// v1 memberships trả `created_at` dạng chuỗi ISO 8601 (đã xác nhận qua docs Whop),
// KHÁC với v5 trả số giây unix — parse được cả 2 kiểu để tránh Invalid Date.
function membershipCreatedMs(m) {
  const v = m.created_at;
  if (v == null) return null;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  const t = Date.parse(v);
  return isNaN(t) ? null : t;
}

// Lấy object user (nếu đã expand) và id user từ 1 membership.
// Whop v5: trường tên là `user` (mặc định là chuỗi ID, expand[]=user -> object).
function extractUser(m) {
  let obj = null;
  let id = null;
  if (m.user && typeof m.user === "object") {
    obj = m.user;
    id = m.user.id || null;
  } else if (typeof m.user === "string") {
    id = m.user;
  } else if (m.user_id) {
    id = m.user_id;
  }
  return { obj, id };
}

export const handler = async (event) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  const debug = !!(event.queryStringParameters && event.queryStringParameters.debug);

  // Leaderboard luôn free-tier — không gate ở đây, chỉ cần resolve companyId.
  const { companyId } = await getAuthContext(event);
  if (!companyId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Could not identify the community (companyId). Please open this page inside Whop." }),
    };
  }

  let apiKey;
  try {
    apiKey = await getCompanyAccessToken(companyId);
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: `Could not get an access token for the company: ${err.message}` }),
    };
  }
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  const cfg = await getTenantConfig(companyId);
  const FX = cfg.fx;
  // companyId ở trên là tenantId nội bộ (có thể = company_id thật, hoặc là
  // tenantId cũ với tenant đã migrate) — 2 endpoint dưới đây + memberships
  // cần company_id THẬT dạng biz_xxx (bắt buộc từ khi đổi sang App API key
  // chung, xem _tokens.mjs).
  const realCompanyId = await getRealCompanyId(companyId);

  try {
    // 1) Memberships — phân trang để lấy HẾT (không dừng ở 50)
    let members = [];
    let membersStatus = null;
    for (let page = 1; page <= 5; page++) {
      const r = await fetch(
        `https://api.whop.com/api/v1/memberships?company_id=${realCompanyId}&page=${page}&per_page=100&expand[]=user&expand[]=plan`,
        { headers }
      );
      if (page === 1) membersStatus = r.status;
      if (!r.ok) break;
      const j = await r.json();
      const batch = j.data || [];
      members = members.concat(batch);
      const totalPages = j.pagination && j.pagination.total_pages;
      if (!totalPages || page >= totalPages || batch.length === 0) break;
    }

    // Member cap (Free 50 / Paid 500) theo ngày tham gia SỚM NHẤT — cắt NGAY
    // TRƯỚC pipeline enrichment tốn API (affiliates/payments/per-user fetch ở
    // dưới) để tenant free thực sự giảm chi phí gọi Whop, không chỉ ẩn ở UI.
    // Filter active-only trước khi đếm totalMembersReal để không tính expired/cancelled.
    const ACTIVE_STATUS_EARLY = ["active","completed","trialing","past_due","canceling"];
    const activeBeforeCap = members.filter(m =>
      m.valid === true || ACTIVE_STATUS_EARLY.includes(String(m.status || "").toLowerCase())
    );
    const totalMembersReal = activeBeforeCap.length;
    const paid = await isPaidTier(companyId);
    const tierLevel = await getTierLevel(companyId);
    const memberCap = [50, 500, 9999, 9999][tierLevel] ?? 50;
    members = activeBeforeCap
      .slice()
      .sort((a, b) => (membershipCreatedMs(a) || 0) - (membershipCreatedMs(b) || 0))
      .slice(0, memberCap);

    // 2) Affiliates — App API key cần company_id, dùng endpoint v1 (v5 chỉ
    // scope đúng theo company của chính key, không tôn trọng companyId/
    // company_id truyền vào khi gọi bằng App API key chung).
    const affiliatesRes = await fetch(
      `https://api.whop.com/api/v1/affiliates?company_id=${realCompanyId}&first=50`,
      { headers }
    );
    let affiliatesData = { data: [] };
    if (affiliatesRes.ok) {
      const j = await affiliatesRes.json();
      affiliatesData = { data: j.nodes || j.data || [] };
    } else {
      const fallback = await fetch(`${WHOP_API}/company/affiliates?company_id=${realCompanyId}&page=1&per_page=50`, { headers });
      if (fallback.ok) affiliatesData = await fallback.json();
    }
    const affiliates = affiliatesData.data || [];

    const parseUsd = (s) => Number(String(s ?? "0").replace(/[^0-9.]/g, "")) || 0;
    const affiliateMap = {};
    affiliates.forEach((a) => {
      const uid =
        a.user_id ||
        a.affiliate_user_id ||
        (a.user && typeof a.user === "object" ? a.user.id : a.user);
      if (uid) {
        affiliateMap[uid] = {
          referrals: a.total_referrals_count ?? a.referral_count ?? 0,
          commission: parseUsd(a.total_referral_earnings_usd ?? a.commission_earned),
          revenue: parseUsd(a.total_revenue_usd),
        };
      }
    });

    const referralsByUsername = {};
    members.forEach((m) => {
      const aff = m.affiliate_username;
      if (aff) referralsByUsername[aff] = (referralsByUsername[aff] || 0) + 1;
    });

    const paidInfo = {};
    let paymentsStatus = null;
    let samplePayment = null;
    const statusReport = {};
    const unknownStatuses = {};
    const norm = (s) => String(s || "").toLowerCase().trim().replace(/\s+/g, "_");
    const GOOD = ["paid", "succeeded", "completed", "success", "successful"];
    const BAD_KEYS = ["fail", "incomplete", "open", "draft", "void", "cancel",
      "expire", "refund", "dispute", "chargeback", "resolution_lost", "lost",
      "uncollect", "pending", "processing", "requires_"];
    const _now = new Date();
    const MONTH_START = Date.UTC(_now.getUTCFullYear(), _now.getUTCMonth(), 1);
    function paidTimestamp(p) {
      const v = p.paid_at ?? p.created_at ?? p.paid_at_unix;
      if (v == null) return null;
      if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
      const t = Date.parse(v);
      return isNaN(t) ? null : t;
    }
    function harvestPayments(arr) {
      arr.forEach((p) => {
        const uid = p.user_id || (p.user && (typeof p.user === "object" ? p.user.id : p.user));
        const amt = Number(
          p.final_amount ?? p.subtotal ?? p.amount ?? p.total ?? p.usd_amount ?? p.final ?? 0
        );
        const refunded = Number(p.refunded_amount ?? 0);
        const status = norm(p.status);
        const sub = norm(p.substatus);

        const hasRefund = !!p.refunded_at || (refunded > 0 && refunded >= amt) || sub.includes("refund");
        const isBad = BAD_KEYS.some((k) => status.includes(k) || sub.includes(k));
        const goodStatus = GOOD.includes(status);
        const ok =
          amt > 0 && !hasRefund && !isBad && (goodStatus || (!!p.paid_at && status === ""));

        const key = status || "(empty)";
        if (!statusReport[key]) statusReport[key] = { count: 0, vip: 0, excluded: 0 };
        statusReport[key].count++;
        statusReport[key][ok ? "vip" : "excluded"]++;
        if (amt > 0 && status && !goodStatus && !isBad) {
          unknownStatuses[status] = (unknownStatuses[status] || 0) + 1;
        }

        if (uid && ok) {
          const net = amt - (refunded > 0 ? refunded : 0);
          if (net <= 0) return;
          const cur = String(p.currency || "usd").toLowerCase();
          if (!paidInfo[uid]) paidInfo[uid] = { amount: 0, currency: cur, amountMonth: 0 };
          paidInfo[uid].amount += net;
          paidInfo[uid].currency = cur;
          const ts = paidTimestamp(p);
          if (ts != null && ts >= MONTH_START) paidInfo[uid].amountMonth += net;
        }
      });
    }
    for (let page = 1; page <= 3; page++) {
      try {
        const r = await fetch(`https://api.whop.com/api/v1/payments?company_id=${realCompanyId}&page=${page}&per_page=100`, { headers });
        if (page === 1) paymentsStatus = r.status;
        if (!r.ok) break;
        const j = await r.json();
        const arr = j.data || j.payments || [];
        if (page === 1 && arr[0]) samplePayment = arr[0];
        harvestPayments(arr);
        const tp = j.pagination && j.pagination.total_pages;
        if (!tp || page >= tp || arr.length === 0) break;
      } catch (_) { break; }
    }
    const paidUsers = new Set(Object.keys(paidInfo));

    const referralRevenueMonth = {};
    members.forEach((m) => {
      const aff = m.affiliate_username;
      if (!aff) return;
      const { id: muid } = extractUser(m);
      const pinfo = muid && paidInfo[muid];
      if (!pinfo || pinfo.amountMonth <= 0) return;
      const usd = pinfo.amountMonth * (FX[(pinfo.currency || "usd").toLowerCase()] ?? 1);
      referralRevenueMonth[aff] = (referralRevenueMonth[aff] || 0) + usd;
    });

    function planPrice(pl) {
      if (!pl || typeof pl !== "object") return 0;
      return Number(pl.initial_price ?? pl.renewal_price ?? pl.price ?? pl.base_price ?? pl.amount ?? 0);
    }
    function extractPlan(m) {
      let obj = null, id = null;
      if (m.plan && typeof m.plan === "object") { obj = m.plan; id = m.plan.id || null; }
      else if (typeof m.plan === "string") { id = m.plan; }
      else if (m.plan_id) { id = m.plan_id; }
      return { obj, id };
    }

    function isPaidMember(m, userId) {
      return paidUsers.has(userId);
    }

    const needFetch = [];
    members.forEach((m) => {
      const { obj, id } = extractUser(m);
      if (id && (!obj || !pickUsername(obj))) needFetch.push(id);
    });

    async function fetchUser(uid) {
      try {
        const r1 = await fetch(`https://api.whop.com/api/v1/users/${uid}`, { headers });
        if (r1.ok) {
          const j1 = await r1.json();
          const u1 = j1.data || j1;
          if (pickUsername(u1)) return u1;
        }
      } catch (_) {}
      try {
        const r2 = await fetch(`${WHOP_API}/users/${uid}`, { headers });
        if (r2.ok) {
          const j2 = await r2.json();
          return j2.data || j2;
        }
      } catch (_) {}
      return null;
    }

    const userMap = {};
    await Promise.all(
      [...new Set(needFetch)].slice(0, 50).map(async (uid) => {
        const u = await fetchUser(uid);
        if (u) userMap[uid] = u;
      })
    );

    if (debug) {
      const sampleId = members[0] ? extractUser(members[0]).id : null;
      let v1Raw = null, v1Status = null, v5Raw = null, v5Status = null;
      if (sampleId) {
        try {
          const r1 = await fetch(`https://api.whop.com/api/v1/users/${sampleId}`, { headers });
          v1Status = r1.status;
          v1Raw = await r1.text();
        } catch (e) { v1Raw = "ERR " + e.message; }
        try {
          const r2 = await fetch(`${WHOP_API}/users/${sampleId}`, { headers });
          v5Status = r2.status;
          v5Raw = await r2.text();
        } catch (e) { v5Raw = "ERR " + e.message; }
      }
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(
          {
            companyId,
            realCompanyId,
            membersStatus,
            affiliatesStatus: affiliatesRes.status,
            memberCount: members.length,
            sampleUserId: sampleId,
            firstMembershipKeys: members[0] ? Object.keys(members[0]) : [],
            firstMembershipRaw: members[0] || null,
            userEndpoint_v1: { status: v1Status, body: v1Raw },
            userEndpoint_v5: { status: v5Status, body: v5Raw },
            paymentsStatus,
            paidUserCount: paidUsers.size,
            paymentStatusReport: statusReport,
            unknownStatusesWithMoney: unknownStatuses,
            samplePayment,
            firstMembershipPlan: members[0] ? extractPlan(members[0]) : null,
            firstMembershipPlanPrice: members[0] ? planPrice(extractPlan(members[0]).obj) : null,
            firstMembershipIsVip: members[0]
              ? isPaidMember(members[0], extractUser(members[0]).id)
              : null,
            statusBreakdown: members.reduce((o,m)=>{const s=String(m.status||'?');o[s]=(o[s]||0)+1;return o;},{}),
            referralsByUsername,
          },
          null,
          2
        ),
      };
    }

    const now = Date.now();
    const REAL_STATUS = ["active","completed","trialing","past_due","canceling"];
    const allMembers = members
      .filter((m) => m.valid === true || REAL_STATUS.includes(String(m.status || "").toLowerCase()))
      .map((m) => {
        const { obj, id } = extractUser(m);
        const fetched = id ? userMap[id] : null;

        const username =
          pickUsername(obj) ||
          pickUsername(fetched) ||
          `User_${(id || "").slice(-4)}`;

        const avatar = pickAvatar(obj) || pickAvatar(fetched) || null;

        const joinedMs = membershipCreatedMs(m);
        const joinedAt = joinedMs != null ? new Date(joinedMs) : new Date();
        const daysJoined = Math.floor((now - joinedAt.getTime()) / (1000 * 60 * 60 * 24));
        const affEndpoint = affiliateMap[id] || { referrals: 0, commission: 0, revenue: 0 };
        const referralCount = referralsByUsername[username] ?? affEndpoint.referrals ?? 0;
        const aff = { referrals: referralCount, commission: affEndpoint.commission, revenue: affEndpoint.revenue };
        const streak = Math.min(daysJoined, 30);

        const pinfo = paidInfo[id] || null;

        const paidUsd = pinfo ? pinfo.amount * (FX[(pinfo.currency||'usd').toLowerCase()] ?? 1) : 0;
        const monthsJoined = Math.min(Math.floor(daysJoined / 30), 12);
        const score = Math.round(
          paidUsd * 1 +
          aff.referrals * 50 +
          monthsJoined * 2
        );

        const paidUsdMonth = pinfo ? pinfo.amountMonth * (FX[(pinfo.currency||'usd').toLowerCase()] ?? 1) : 0;
        const referralUsdMonth = referralRevenueMonth[username] || 0;
        const seasonScoreMonth = Math.round(paidUsdMonth + referralUsdMonth);

        return {
          userId: id,
          username,
          avatar,
          paid: isPaidMember(m, id),
          paidAmount: pinfo ? pinfo.amount : 0,
          paidAmountMonth: pinfo ? pinfo.amountMonth : 0,
          paidCurrency: pinfo ? pinfo.currency : null,
          referralUsdMonth: Math.round(referralUsdMonth),
          seasonScoreMonth,
          joinedAt: joinedAt.toISOString(),
          daysJoined,
          referrals: aff.referrals,
          commission: aff.commission,
          streak,
          score,
        };
      });

    const top50ByScore = [...allMembers].sort((a, b) => b.score - a.score).slice(0, 50);
    const topSeasonExtra = [...allMembers]
      .filter((m) => m.seasonScoreMonth > 0)
      .sort((a, b) => b.seasonScoreMonth - a.seasonScoreMonth)
      .slice(0, 20);
    const seenIds = new Set(top50ByScore.map((m) => m.userId));
    const leaderboard = [...top50ByScore];
    topSeasonExtra.forEach((m) => {
      if (!seenIds.has(m.userId)) { leaderboard.push(m); seenIds.add(m.userId); }
    });

    const stats = {
      totalMembers: members.length,
      totalMembersReal,
      paidMembers: paidUsers.size,
      totalReferrals: Object.values(referralsByUsername).reduce((s, n) => s + n, 0)
        || affiliates.reduce((s, a) => s + (a.total_referrals_count ?? a.referral_count ?? 0), 0),
      totalCommission: affiliates
        .reduce((s, a) => s + parseUsd(a.total_referral_earnings_usd ?? a.commission_earned), 0)
        .toFixed(2),
    };

    const commissionByUsername = {};
    affiliates.forEach((a) => {
      const uname = a.user?.username || a.username || null;
      if (uname) {
        const parseUsdStr = (s) => Number(String(s ?? "0").replace(/[^0-9.]/g, "")) || 0;
        commissionByUsername[uname] = parseUsdStr(a.total_referral_earnings_usd ?? a.commission_earned);
      }
    });

    const affiliateBoard = Object.entries(referralsByUsername)
      .map(([username, count]) => ({
        username,
        referrals: count,
        commission: commissionByUsername[username] || 0,
        avatar: null,
      }))
      .sort((a, b) => b.referrals - a.referrals || b.commission - a.commission);

    await Promise.allSettled(
      affiliateBoard.slice(0, 10).map(async (a) => {
        try {
          const r = await fetch(
            `https://api.whop.com/api/v1/users/${a.username}`,
            { headers }
          );
          if (r.ok) {
            const u = await r.json();
            a.avatar = u.profile_picture?.url || null;
            a.displayName = u.name || u.username || a.username;
          }
        } catch (_) {}
      })
    );

    const _n = new Date();
    const _endMs = Date.UTC(_n.getUTCFullYear(), _n.getUTCMonth() + 1, 1);
    const season = {
      seasonKey: `${_n.getUTCFullYear()}-${String(_n.getUTCMonth()+1).padStart(2,'0')}`,
      label: `Month ${String(_n.getUTCMonth()+1).padStart(2,'0')}/${_n.getUTCFullYear()}`,
      endsAt: new Date(_endMs).toISOString(),
      secondsLeft: Math.max(0, Math.floor((_endMs - _n.getTime()) / 1000)),
      topRewards: cfg.seasonTopRewards,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ leaderboard, affiliateBoard, stats, season, branding: cfg.branding, isPaid: paid, updatedAt: new Date().toISOString() }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message, stack: err.stack }),
    };
  }
};

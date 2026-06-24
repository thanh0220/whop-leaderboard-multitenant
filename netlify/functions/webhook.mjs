import crypto from "node:crypto";
import { pointsStore, tenantKey } from "./_store.mjs";
import { getTenantConfig, getTenantIdByRealCompanyId, setTenantTier } from "./_tenant.mjs";

const WHOP_API = "https://api.whop.com/api/v5";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

// Webhook ở cấp APP (đăng ký 1 lần trên Whop Dev Dashboard, dùng chung cho
// MỌI tenant cài app) — event payment_succeeded. Khi 1 member mua hàng thật,
// TOÀN BỘ member khác trong cùng tenant đó nhận 1 "Rương Liên Minh" (Gỗ/Bạc/
// Vàng theo số tiền) vào mailbox của họ — xem mailbox.mjs để claim.

function pickUsername(u) {
  if (!u || typeof u !== "object") return null;
  return u.username || u.name || (u.email ? String(u.email).split("@")[0] : null) || null;
}

async function fetchAllActiveMembers(apiKey) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const REAL_STATUS = ["active", "completed", "trialing", "past_due", "canceling"];
  let members = [];
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`${WHOP_API}/company/memberships?page=${page}&per_page=100&expand[]=user`, { headers });
    if (!r.ok) break;
    const j = await r.json();
    const batch = j.data || [];
    members = members.concat(batch);
    const tp = j.pagination && j.pagination.total_pages;
    if (!tp || page >= tp || batch.length === 0) break;
  }
  return members
    .filter((m) => m.valid === true || REAL_STATUS.includes(String(m.status || "").toLowerCase()))
    .map((m) => {
      const u = m.user && typeof m.user === "object" ? m.user : null;
      const id = u ? u.id : (typeof m.user === "string" ? m.user : m.user_id || null);
      return { userId: id };
    })
    .filter((m) => m.userId);
}

function pickTier(usd, thresholds) {
  const sorted = [...thresholds].sort((a, b) => b.minUsd - a.minUsd);
  return sorted.find((t) => usd >= t.minUsd) || sorted[sorted.length - 1];
}

function rollXu(range) {
  if (!range) return 5;
  const min = Number(range.min) || 0, max = Number(range.max) || min;
  return Math.floor(min + Math.random() * (max - min + 1));
}

// Xác minh chữ ký webhook theo chuẩn Standard Webhooks (3 header riêng:
// webhook-id/webhook-timestamp/webhook-signature) — KHÔNG dùng
// makeWebhookValidator() của @whop/api nữa vì bản cài (^0.0.23) chỉ hỗ trợ
// kiểu ký CŨ (1 header "x-whop-signature" kiểu Stripe) — đã đọc trực tiếp
// source code package xác nhận, và payload thật từ Whop xác nhận họ đã
// chuyển sang kiểu 3-header mới, không còn gửi "x-whop-signature" nữa.
// Chưa xác minh được chắc 100% cách encode secret (docs nói base64, nhưng
// secret thật trông như hex) — thử cả 2 cách cho an toàn.
// Đã xác nhận THẬT bằng test webhook: key HMAC = nguyên chuỗi secret (kể cả
// tiền tố "ws_"/"whsec_"), dùng thẳng làm UTF-8 bytes — KHÔNG decode base64
// hay hex gì cả.
function verifyStandardWebhook(headers, body, secrets) {
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const sigHeader = headers["webhook-signature"];
  if (!id || !timestamp || !sigHeader) return null;

  const signedContent = `${id}.${timestamp}.${body}`;
  const sentSigs = sigHeader.split(" ").map((s) => s.split(",")[1]).filter(Boolean);

  for (const secret of secrets) {
    const computed = crypto.createHmac("sha256", Buffer.from(secret, "utf8")).update(signedContent, "utf8").digest("base64");
    if (sentSigs.includes(computed)) return JSON.parse(body);
  }
  return null;
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  // 2 webhook ĐỘC LẬP cùng trỏ về function này, mỗi cái 1 secret riêng:
  // - WHOP_WEBHOOK_SECRET: webhook cấp APP (Ranking GTVan → Webhooks) — nhận
  //   payment_succeeded của MEMBER mua hàng từ TENANT (Flow A, phát rương).
  // - WHOP_WEBHOOK_SECRET_2: webhook cấp COMPANY (Developer → Webhooks ngoài
  //   app) — nhận payment_succeeded khi CHÍNH company này (GTVăn) được trả
  //   tiền, vd admin tenant mua Leaderboard Pro (Flow B, set tier paid).
  // Không biết request tới từ webhook nào trước khi xác minh, nên thử cả 2.
  const secrets = [process.env.WHOP_WEBHOOK_SECRET, process.env.WHOP_WEBHOOK_SECRET_2].filter(Boolean);
  if (secrets.length === 0) {
    return json(500, { error: "Missing WHOP_WEBHOOK_SECRET / WHOP_WEBHOOK_SECRET_2 environment variable." });
  }

  const payload = verifyStandardWebhook(event.headers || {}, event.body || "", secrets);
  if (!payload) {
    return json(400, { error: "Invalid webhook signature." });
  }

  // Chống xử lý trùng (Whop có thể gửi lại cùng 1 event).
  const eventId = payload.id || payload.data?.id;
  const store = pointsStore();
  if (eventId) {
    try {
      const seen = await store.get(tenantKey("webhook-seen", eventId));
      if (seen) return json(200, { ok: true, dedup: true });
      await store.set(tenantKey("webhook-seen", eventId), "1");
    } catch (_) {}
  }

  // XÁC NHẬN THẬT từ payload webhook thật (không phải đoán): field "type" gửi
  // về là "payment.succeeded" (CÓ DẤU CHẤM) — khác với tên "payment_succeeded"
  // (gạch dưới) hiển thị trên checkbox chọn event ở Whop Dashboard. Giữ cả 2
  // dạng để an toàn (phòng trường hợp version/nguồn khác dùng gạch dưới).
  const action = payload.action || payload.type;
  if (action !== "payment_succeeded" && action !== "payment.succeeded") {
    return json(200, { ok: true, skipped: action });
  }

  const data = payload.data || {};

  // Thanh toán nâng cấp Pro của CHÍNH app này (admin trả tiền cho dev qua
  // create-upgrade-checkout.mjs) — company_id ở đây là company CỦA DEV, không
  // map được qua getTenantIdByRealCompanyId (chỉ ánh xạ company của tenant) —
  // nên phải tách riêng, đọc metadata.tenantId đã gắn lúc tạo checkout session.
  // Đường dẫn field metadata thật CHƯA xác minh bằng webhook test thật — thử
  // vài vị trí hợp lý nhất, BẮT BUỘC log/kiểm tra lại khi có webhook test đầu tiên.
  const upgradeTenantId = data.metadata?.tenantId || payload.metadata?.tenantId || null;
  if (upgradeTenantId) {
    try {
      await setTenantTier(upgradeTenantId, "paid");
      return json(200, { ok: true, upgraded: upgradeTenantId });
    } catch (err) {
      return json(500, { error: err.message });
    }
  }

  const realCompanyId = data.company_id || data.company?.id || data.business_id || null;
  if (!realCompanyId) return json(200, { ok: true, skipped: "no-company-id" });

  const tenantId = await getTenantIdByRealCompanyId(realCompanyId);
  if (!tenantId) return json(200, { ok: true, skipped: "tenant-not-found" });

  try {
    const cfg = await getTenantConfig(tenantId);
    if (!cfg.whopApiKey) return json(200, { ok: true, skipped: "tenant-not-configured" });

    const amount = Number(data.final_amount ?? data.amount ?? data.subtotal ?? data.total ?? 0);
    if (amount <= 0) return json(200, { ok: true, skipped: "zero-amount" });
    const currency = String(data.currency || "usd").toLowerCase();
    const usd = amount * (cfg.fx[currency] ?? 1);

    const rules = cfg.chestRules;
    const tier = pickTier(usd, rules.thresholds);
    const xu = rollXu(rules.rewardRange[tier.tier]);

    const buyerUserId = data.user_id || (typeof data.user === "string" ? data.user : data.user?.id) || null;

    let buyerName = data.user?.username || data.user?.name || pickUsername(data.user) || data.user_id || "A member";
    if (!data.user?.username && buyerUserId) {
      try {
        const r = await fetch(`https://api.whop.com/api/v1/users/${buyerUserId}`, {
          headers: { Authorization: `Bearer ${cfg.whopApiKey}` },
        });
        if (r.ok) { const u = await r.json(); buyerName = pickUsername(u) || buyerName; }
      } catch (_) {}
    }

    const members = await fetchAllActiveMembers(cfg.whopApiKey);
    const now = Date.now();
    const expiresAt = new Date(now + (rules.expiryHours || 48) * 3600 * 1000).toISOString();
    const entryBase = {
      tier: tier.tier,
      label: tier.label,
      icon: tier.icon,
      xu,
      buyerName,
      createdAt: new Date(now).toISOString(),
      expiresAt,
      claimed: false,
    };

    async function appendMailbox(userId, entry) {
      const key = tenantKey("mailbox", tenantId, userId);
      let list = [];
      try {
        const s = await store.get(key, { type: "json" });
        if (Array.isArray(s)) list = s;
      } catch (_) {}
      list = list.filter((e) => !e.claimed || new Date(e.expiresAt).getTime() > now - 14 * 86400000);
      list.unshift(entry);
      list = list.slice(0, 50);
      await store.setJSON(key, list);
    }

    await Promise.allSettled(
      members.map((m) =>
        appendMailbox(m.userId, { id: `${eventId || now}_${m.userId}`, ...entryBase })
      )
    );

    // Rương "Cảm ơn đã mua hàng" — phát THẲNG cho chính người mua, ngoài
    // rương cộng đồng ở trên (đúng lúc dễ refund nhất sau khi vừa trả tiền).
    let buyerXu = null;
    if (buyerUserId) {
      buyerXu = rollXu(rules.buyerReward);
      await appendMailbox(buyerUserId, {
        id: `${eventId || now}_thanks_${buyerUserId}`,
        tier: "buyer",
        label: "🎉 Thank you for your purchase!",
        icon: "🎉",
        xu: buyerXu,
        buyerName,
        createdAt: new Date(now).toISOString(),
        expiresAt,
        claimed: false,
      });
    }

    return json(200, { ok: true, tenantId, tier: tier.tier, xu, buyerXu, grantedTo: members.length });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

import { pointsStore, tenantKey, casUpdate, InsufficientFundsError } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getTenantConfig } from "./_tenant.mjs";
import { getCompanyAccessToken } from "./_tokens.mjs";
import { computeEarned } from "./_points.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

export const handler = async (event) => {
  const { userId, companyId } = await getAuthContext(event);
  if (!userId)    return json(401, { error: "Could not identify the user." });
  if (!companyId) return json(400, { error: "Could not identify the community." });

  const cfg   = await getTenantConfig(companyId);
  const store = pointsStore();

  // ── GET — trả danh sách video + trạng thái mở khoá của user ──────────────
  if (event.httpMethod === "GET") {
    const [unlockedRaw, piecesRaw] = await Promise.all([
      store.get(tenantKey("videos-unlocked", companyId, userId), { type: "json" }).catch(() => null),
      store.get(tenantKey("pieces",          companyId, userId), { type: "json" }).catch(() => null),
    ]);
    const unlocked = (unlockedRaw && typeof unlockedRaw === "object") ? unlockedRaw : {};
    const pieces   = (piecesRaw   && typeof piecesRaw   === "object") ? piecesRaw   : {};

    const apiKey = await getCompanyAccessToken(companyId);
    const { earned } = await computeEarned(userId, apiKey, companyId, cfg);
    const spent = Number(await store.get(tenantKey("spent", companyId, userId)).catch(() => null)) || 0;

    return json(200, {
      videos:        cfg.lockedVideos  || [],
      unlocked,
      pieces,
      xuAvailable:   earned - spent,
      videoSettings: cfg.videoSettings || { enabled: true, xuPerPiece: 0 },
      puzzlePieces:  cfg.puzzlePieces  || [{ id: "manh_hiem", name: "Mảnh Hiếm", icon: "🧩" }],
      branding:      cfg.branding      || {},
    });
  }

  if (event.httpMethod !== "POST") return json(405, { error: "GET or POST" });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}

  // ── POST action=unlock — trừ mảnh, thêm vào unlocked ─────────────────────
  if (body.action === "unlock") {
    const video = (cfg.lockedVideos || []).find(v => v.id === body.videoId);
    if (!video) return json(400, { error: "Video không tồn tại." });
    if (video.free) return json(200, { ok: true, url: video.url });

    const pieceCost = Number(video.pieceCost) || 1;
    const pieceId   = (cfg.puzzlePieces || [])[0]?.id || "manh_hiem";

    const unlockedKey = tenantKey("videos-unlocked", companyId, userId);
    const existing    = await store.get(unlockedKey, { type: "json" }).catch(() => null) || {};
    if (existing[body.videoId]) return json(200, { ok: true, url: video.url, alreadyUnlocked: true });

    const piecesKey = tenantKey("pieces", companyId, userId);
    let insufficient = false;
    try {
      await casUpdate(store, piecesKey, (current) => {
        const inv = (current && typeof current === "object") ? { ...current } : {};
        if ((inv[pieceId] || 0) < pieceCost) { insufficient = true; throw new Error("NOT_ENOUGH_PIECES"); }
        inv[pieceId] = (inv[pieceId] || 0) - pieceCost;
        return inv;
      });
    } catch (e) {
      if (insufficient) return json(402, { error: `Không đủ mảnh. Cần ${pieceCost}× Mảnh Hiếm.` });
      throw e;
    }

    await casUpdate(store, unlockedKey, (current) => {
      const u = (current && typeof current === "object") ? { ...current } : {};
      u[body.videoId] = true;
      return u;
    });

    return json(200, { ok: true, url: video.url });
  }

  // ── POST action=buy-pieces — trừ XU, cộng mảnh ───────────────────────────
  if (body.action === "buy-pieces") {
    const settings   = cfg.videoSettings || {};
    const xuPerPiece = Number(settings.xuPerPiece) || 0;
    if (!xuPerPiece) return json(400, { error: "Tính năng mua mảnh bằng XU chưa được bật." });

    const count    = Math.max(1, Math.min(50, parseInt(body.count, 10) || 1));
    const totalXU  = xuPerPiece * count;
    const pieceId  = (cfg.puzzlePieces || [])[0]?.id || "manh_hiem";

    const apiKey = await getCompanyAccessToken(companyId);
    const { earned } = await computeEarned(userId, apiKey, companyId, cfg);

    try {
      await casUpdate(store, tenantKey("spent", companyId, userId), (current) => {
        const spent = Number(current) || 0;
        if (earned - spent < totalXU) throw new InsufficientFundsError({ available: earned - spent, cost: totalXU });
        return String(spent + totalXU);
      }, { type: "text" });
    } catch (e) {
      if (e instanceof InsufficientFundsError) return json(402, { error: "Không đủ XU.", available: e.available, cost: e.cost });
      throw e;
    }

    await casUpdate(store, tenantKey("pieces", companyId, userId), (current) => {
      const inv = (current && typeof current === "object") ? { ...current } : {};
      inv[pieceId] = (inv[pieceId] || 0) + count;
      return inv;
    });

    return json(200, { ok: true, pieces: count, xuSpent: totalXU });
  }

  return json(400, { error: "Unknown action." });
};

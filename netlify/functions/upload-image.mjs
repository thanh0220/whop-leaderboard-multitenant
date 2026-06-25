import { pointsStore, tenantKey } from "./_store.mjs";
import { getAuthContext, isCompanyAdmin } from "./_auth.mjs";
import { getRealCompanyId } from "./_tokens.mjs";
import { isPaidTier } from "./_tenant.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB giải mã — admin nên chọn file gốc ≤3MB

function newId() {
  try { return crypto.randomUUID(); }
  catch (_) { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
}

// Upload ảnh quà cho 1 tenant. companyId LUÔN lấy từ getAuthContext (referer),
// KHÔNG nhận từ body — để member/tenant khác không thể ghi ảnh vào namespace
// của tenant khác bằng cách tự gửi companyId giả trong request.
export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Could not identify the user." });
  if (!companyId) return json(400, { error: "Could not identify the community." });

  // Chỉ admin/owner của company mới được upload ảnh (tính năng hiện tại — ảnh
  // Event — chỉ admin.html mới gọi tới, chặn member thường lợi dụng endpoint
  // này để lưu trữ/host ảnh tuỳ ý qua hạ tầng app).
  const realCompanyId = await getRealCompanyId(companyId);
  if (!(await isCompanyAdmin(userId, realCompanyId))) {
    return json(403, { error: "Only the community admin can upload images." });
  }
  // Upload từ máy chỉ mở cho Paid tier (Free vẫn dùng được cách dán link ảnh
  // ngoài) — chặn cả khi gọi thẳng API, không chỉ ẩn nút ở UI.
  if (!(await isPaidTier(companyId))) {
    return json(402, { error: "Uploading images is a paid feature. Upgrade to unlock it, or paste an image link instead." });
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}
  const { filename, contentType, dataBase64 } = body;

  if (!contentType || !String(contentType).startsWith("image/")) {
    return json(400, { error: "File must be an image (contentType must start with image/)." });
  }
  if (!dataBase64) {
    return json(400, { error: "Missing image data." });
  }

  let bytes;
  try {
    bytes = Buffer.from(dataBase64, "base64");
  } catch (_) {
    return json(400, { error: "Invalid image data (could not decode base64)." });
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return json(400, { error: `Image too large (max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB).` });
  }

  const id = newId();
  const store = pointsStore();
  const key = tenantKey("images", companyId, id);
  try {
    await store.set(key, bytes, {
      metadata: { contentType, filename: filename || "image", uploadedAt: new Date().toISOString() },
    });
  } catch (err) {
    return json(500, { error: `Could not save the image: ${err.message}` });
  }

  return json(200, {
    ok: true,
    id,
    url: `/.netlify/functions/image?id=${id}&companyId=${encodeURIComponent(companyId)}`,
  });
};

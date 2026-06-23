import { pointsStore, tenantKey } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";

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
  if (!userId) return json(401, { error: "Không xác định được người dùng." });
  if (!companyId) return json(400, { error: "Không xác định được community." });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}
  const { filename, contentType, dataBase64 } = body;

  if (!contentType || !String(contentType).startsWith("image/")) {
    return json(400, { error: "File phải là ảnh (contentType bắt đầu bằng image/)." });
  }
  if (!dataBase64) {
    return json(400, { error: "Thiếu dữ liệu ảnh." });
  }

  let bytes;
  try {
    bytes = Buffer.from(dataBase64, "base64");
  } catch (_) {
    return json(400, { error: "Dữ liệu ảnh không hợp lệ (không decode được base64)." });
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return json(400, { error: `Ảnh quá lớn (tối đa ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB).` });
  }

  const id = newId();
  const store = pointsStore();
  const key = tenantKey("images", companyId, id);
  try {
    await store.set(key, bytes, {
      metadata: { contentType, filename: filename || "image", uploadedAt: new Date().toISOString() },
    });
  } catch (err) {
    return json(500, { error: `Không lưu được ảnh: ${err.message}` });
  }

  return json(200, {
    ok: true,
    id,
    url: `/.netlify/functions/image?id=${id}&companyId=${encodeURIComponent(companyId)}`,
  });
};

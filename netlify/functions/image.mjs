import { pointsStore, tenantKey } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";

// PNG 1x1 trong suốt — trả khi không tìm thấy ảnh, để <img> không vỡ giao
// diện (hiện ô trống thay vì icon ảnh hỏng).
const BLANK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function blankResponse() {
  return {
    statusCode: 200,
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    body: BLANK_PNG_BASE64,
    isBase64Encoded: true,
  };
}

// Serve ảnh đã upload qua upload-image.mjs. companyId lấy ƯU TIÊN từ query
// string (URL tự chứa, không lệ thuộc referer — hoạt động cả khi mở ảnh
// trực tiếp ngoài Whop để test), fallback sang referer-sniff nếu thiếu.
export const handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const id = qs.id;
  let companyId = qs.companyId || null;
  if (!companyId) {
    const auth = await getAuthContext(event);
    companyId = auth.companyId;
  }
  if (!id || !companyId) return blankResponse();

  try {
    const store = pointsStore();
    const key = tenantKey("images", companyId, id);
    const result = await store.getWithMetadata(key, { type: "arrayBuffer" });
    if (!result || !result.data) return blankResponse();

    const contentType = result.metadata?.contentType || "application/octet-stream";
    return {
      statusCode: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
      body: Buffer.from(result.data).toString("base64"),
      isBase64Encoded: true,
    };
  } catch (_) {
    return blankResponse();
  }
};

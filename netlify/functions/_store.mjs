import { getStore } from "@netlify/blobs";

// Mở kho lưu điểm. Cấu hình thủ công bằng Site ID + token (chắc ăn khi deploy
// kéo-thả ZIP, lúc Netlify không tự gắn context Blobs).
// Dùng tên biến KHÔNG bắt đầu bằng "NETLIFY_" vì Netlify chặn prefix đó.
export function pointsStore() {
  const siteID =
    process.env.BLOBS_SITE_ID ||
    process.env.NETLIFY_SITE_ID ||
    process.env.SITE_ID;
  const token =
    process.env.BLOBS_TOKEN ||
    process.env.NETLIFY_BLOBS_TOKEN;

  if (siteID && token) {
    return getStore({ name: "points", siteID, token, consistency: "strong" });
  }
  return getStore("points"); // tự động (khi Netlify đã gắn sẵn context)
}

// Ghép key Blob theo dạng "scope:part1:part2...". Dùng cho MỌI key liên quan
// tenant (xu, streak, quest, lịch sử, config, cache) để tránh lẫn dữ liệu giữa
// các business khác nhau — vì userId Whop là ID toàn cục, không riêng theo
// từng business cài app.
export function tenantKey(scope, ...parts) {
  const clean = parts.filter((p) => p != null && p !== "");
  if (clean.length === 0) throw new Error(`tenantKey: thiếu id cho scope "${scope}"`);
  return [scope, ...clean].join(":");
}

// Đọc-sửa-ghi an toàn cho key tiền/trạng thái claim, chống race condition khi
// 2 request cùng đọc giá trị cũ rồi cùng ghi đè (double-spend). Dùng ETag
// optimistic-lock có sẵn của Netlify Blobs: set() chỉ thành công nếu ETag
// chưa đổi từ lúc get(); nếu có request khác ghi trước, thử lại từ đầu.
// updateFn(current) trả giá trị mới (current là null nếu key chưa tồn tại).
// Dùng để updateFn của casUpdate báo "không đủ điều kiện" (vd không đủ XU) —
// ném ra để dừng hẳn (không phải lỗi tranh chấp ETag, không nên retry), caller
// bắt bằng instanceof và trả lỗi nghiệp vụ phù hợp (402...).
export class InsufficientFundsError extends Error {
  constructor(extra) {
    super("insufficient");
    Object.assign(this, extra);
  }
}

export async function casUpdate(store, key, updateFn, { type = "json", maxRetries = 5 } = {}) {
  for (let i = 0; i < maxRetries; i++) {
    const entry = await store.getWithMetadata(key, { type });
    const current = entry ? entry.data : null;
    const next = await updateFn(current);
    const setFn = type === "json" ? store.setJSON.bind(store) : store.set.bind(store);
    const res = await setFn(key, next, entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
    if (res.modified) return next;
  }
  throw new Error(`casUpdate: too many conflicts for key ${key}`);
}

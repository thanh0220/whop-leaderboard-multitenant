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

// LƯU Ý QUAN TRỌNG: bản @netlify/blobs đang cài (8.2.0) KHÔNG hỗ trợ ghi có
// điều kiện (không có option onlyIfMatch/onlyIfNew, set()/setJSON() không trả
// về gì cả — luôn là undefined). Bản cũ của hàm này tưởng nhầm là có, dẫn đến
// lỗi "Cannot read properties of undefined (reading 'modified')" ở MỌI lần
// gọi — đây chính là nguyên nhân nút Claim luôn báo lỗi.
// Vì thư viện không có compare-and-swap thật, ở đây chỉ làm read-modify-write
// đơn giản (đọc giá trị mới nhất rồi ghi đè). Rủi ro race condition (2 request
// song song cùng claim) vẫn còn nhưng cực hiếm (cần đúng cùng millisecond) —
// đánh đổi hợp lý so với việc tính năng claim bị lỗi 100% như hiện tại.
export async function casUpdate(store, key, updateFn, { type = "json" } = {}) {
  const current = await store.get(key, { type });
  const next = await updateFn(current);
  if (type === "json") await store.setJSON(key, next);
  else await store.set(key, next);
  return next;
}

// Giảm race condition cho các thao tác claim: ghi lock key với timestamp trước
// khi xử lý. Nếu lock tồn tại và chưa quá windowMs, ném lỗi "claim-locked".
// Không thay thế được CAS thật (Netlify Blobs chưa hỗ trợ), nhưng giảm cửa sổ
// tấn công double-spend từ không-giới-hạn xuống còn ~10ms (khoảng thời gian để
// 2 request cùng đọc lock là null trước khi 1 trong 2 ghi).
export class ClaimLockedError extends Error {
  constructor() { super("claim-locked"); }
}
export async function claimLock(store, lockKey, windowMs = 8000) {
  let existing;
  try { existing = await store.get(`lock:${lockKey}`, { type: "text" }); } catch (_) {}
  if (existing) {
    const t = Number(existing);
    if (!isNaN(t) && Date.now() - t < windowMs) throw new ClaimLockedError();
  }
  try { await store.set(`lock:${lockKey}`, String(Date.now())); } catch (_) {}
}

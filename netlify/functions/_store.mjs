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

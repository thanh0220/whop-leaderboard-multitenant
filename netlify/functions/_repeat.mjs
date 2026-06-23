// Tiện ích chung cho Nhiệm vụ/Code có ngày bắt đầu/kết thúc + lặp lại theo
// chu kỳ N ngày (dùng ở quests.mjs, redeem-code.mjs, và phía hiển thị lịch).

export function ddiff(a, b) {
  return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);
}

// Không set ngày gì = luôn hoạt động (hành vi cũ). Có set ngày, không lặp =
// active đúng 1 lần trong khung startDate->endDate. Có repeatDays = tái diễn
// mỗi N ngày kể từ startDate, độ dài mỗi lần giữ nguyên = endDate-startDate.
export function isWithinWindow(startDate, endDate, repeatDays, today) {
  if (!startDate && !endDate) return true;
  const start = startDate || endDate;
  const end = endDate || startDate;
  if (!repeatDays) return today >= start && today <= end;
  const since = ddiff(start, today);
  if (since < 0) return false;
  return (since % repeatDays) <= ddiff(start, end);
}

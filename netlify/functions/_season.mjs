// Tiện ích thời vụ: mốc ngày UTC, key mùa giải theo tháng dương lịch.

export function utcDayKey(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function seasonKey(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`; // VD "2026-06"
}

// Trả về { seasonKey, endsAt (ISO), secondsLeft, label } cho mùa hiện tại
export function seasonInfo(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const endMs = Date.UTC(y, m + 1, 1, 0, 0, 0); // 1 ngày đầu tháng sau (UTC)
  const secondsLeft = Math.max(0, Math.floor((endMs - now.getTime()) / 1000));
  const monthNames = ["01","02","03","04","05","06","07","08","09","10","11","12"];
  return {
    seasonKey: seasonKey(now),
    endsAt: new Date(endMs).toISOString(),
    secondsLeft,
    label: `Tháng ${monthNames[m]}/${y}`,
  };
}

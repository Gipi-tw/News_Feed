// Date helpers. The pipeline is timezone-aware (Taipei) so "today" matches the
// 08:00 Asia/Taipei cron, regardless of where the server runs.

export function todayInTz(timeZone = "Asia/Taipei"): string {
  // en-CA gives YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** "2026 年 6 月 7 日（日）" for the masthead. */
export function formatChineseDate(date: string, timeZone = "Asia/Taipei"): string {
  const d = new Date(date + "T12:00:00Z");
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(d);
  const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  return `${get("year")} 年 ${get("month")} 月 ${get("day")} 日（${WEEKDAYS[idx] ?? ""}）`;
}

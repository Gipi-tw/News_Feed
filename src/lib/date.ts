// Date helpers. The pipeline is timezone-aware (Taipei) so "today" matches the
// 08:00 Asia/Taipei cron, regardless of where the server runs.

export function todayInTz(timeZone = "Asia/Taipei"): string {
  // en-CA gives YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** A digest date in a URL: /2026-10-21. */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "二" for 2026-10-21 (a plain calendar date, no timezone involved). */
export function weekday(date: string): string {
  return WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

/** "10/7" for 2026-10-07. */
export function monthDay(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}/${d}`;
}

/** "10/21（三）" this year, "2025/12/31（三）" otherwise — short enough for a 360px row. */
export function dayLabel(date: string, thisYear: string): string {
  return `${date.startsWith(thisYear) ? "" : `${date.slice(0, 4)}/`}${monthDay(date)}（${weekday(date)}）`;
}

/** URL of one day's digest; `?e=` only when it isn't that day's latest edition. */
export function dayHref(date: string, edition?: number, latestEdition?: number): string {
  return edition && latestEdition && edition !== latestEdition ? `/${date}?e=${edition}` : `/${date}`;
}

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

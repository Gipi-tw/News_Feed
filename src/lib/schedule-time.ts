// Pure time helpers for the in-process scheduler (kept DB-free so they can be
// unit-tested).

/** Minutes after local midnight for a daily cron "M H * * *"; null otherwise. */
export function parseDailyCron(expr: string): number | null {
  const m = expr.trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (!m) return null;
  const minute = Number(m[1]);
  const hour = Number(m[2]);
  if (minute > 59 || hour > 23) return null;
  return hour * 60 + minute;
}

/** Minutes after midnight, now, in `timeZone`. */
export function localMinutes(timeZone: string, now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/**
 * The start of today's slot as an absolute time, if we're inside the window
 * [slot, slot + graceMinutes); otherwise null. The grace window lets a deploy
 * or restart shortly after the slot still produce today's run.
 */
export function dueSlotStart(
  slotMinutes: number,
  graceMinutes: number,
  timeZone: string,
  now = new Date(),
): Date | null {
  const m = localMinutes(timeZone, now);
  if (m < slotMinutes || m >= slotMinutes + graceMinutes) return null;
  const sinceSlotMs = (m - slotMinutes) * 60_000 + now.getSeconds() * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - sinceSlotMs);
}

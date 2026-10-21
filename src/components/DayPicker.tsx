import Link from "next/link";
import type { DayEntry } from "@/lib/digest-data";
import { dayHref, dayLabel, monthDay, todayInTz } from "@/lib/date";
import DayJump from "./DayJump";

// "‹ 前一天｜日期選單｜後一天 ›" above every digest, so any day is one tap
// away; each day also has its own URL (/2026-10-21).
export default function DayPicker({ date, edition, days }: { date: string; edition?: number; days: DayEntry[] }) {
  if (!days.length) return null;
  const latest = (d: DayEntry) => d.editions[d.editions.length - 1].edition;
  // Days are newest first; a date without a digest sits between its neighbours.
  const older = days.find((d) => d.date < date);
  const newer = [...days].reverse().find((d) => d.date > date);
  const thisYear = todayInTz().slice(0, 4);
  const options = days.flatMap((d) =>
    [...d.editions].reverse().map((e) => ({
      href: dayHref(d.date, e.edition, latest(d)),
      label: `${dayLabel(d.date, thisYear)}${d.editions.length > 1 ? ` 第 ${e.edition} 期` : ""}｜${e.count} 篇`,
    })),
  );
  const today = days.find((d) => d.date === date);
  const current = today ? dayHref(date, edition ?? latest(today), latest(today)) : "";

  return (
    <nav className="daypicker" aria-label="選擇日期">
      {older ? (
        <Link href={dayHref(older.date)} className="step">
          ‹ {monthDay(older.date)}
        </Link>
      ) : (
        <span className="step off">‹</span>
      )}
      <DayJump value={current} options={options} />
      {newer ? (
        <Link href={dayHref(newer.date)} className="step">
          {monthDay(newer.date)} ›
        </Link>
      ) : (
        <span className="step off">›</span>
      )}
    </nav>
  );
}

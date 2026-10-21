import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDigestByDate, listDays } from "@/lib/digest-data";
import { DATE_RE, formatChineseDate } from "@/lib/date";
import DigestView from "@/components/DigestView";
import DayPicker from "@/components/DayPicker";

// One day's digest at its own URL: /2026-10-21 (latest edition of that day),
// /2026-10-21?e=1 for an earlier edition. Static routes (/history, /search…)
// take precedence over this one.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ date: string }>; searchParams: Promise<{ e?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { date } = await params;
  return { title: DATE_RE.test(date) ? `內容摘要日報 ${date}` : "內容摘要日報" };
}

export default async function DayPage({ params, searchParams }: Props) {
  const { date } = await params;
  if (!DATE_RE.test(date)) notFound();
  const { e } = await searchParams;
  const digest = await getDigestByDate(date, Number(e) || undefined);
  if (digest) return <DigestView digest={digest} />;

  // No digest that day: say so, and let the picker offer the nearest days.
  return (
    <div className="wrap">
      <header className="masthead">
        <h1>內容摘要日報</h1>
        <div className="meta">{formatChineseDate(date)}｜這天沒有日報</div>
        <DayPicker date={date} days={await listDays()} />
      </header>
    </div>
  );
}

import { prisma } from "../lib/db";
import type { DedupRecord } from "../lib/types";

function daysAgo(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Recent published entries within the dedup window (for soft event-matching). */
export async function getRecentEntries(
  today: string,
  windowDays: number,
): Promise<{ urls: Set<string>; titles: string[] }> {
  const since = daysAgo(today, windowDays);
  const rows = await prisma.dedupEntry.findMany({
    where: { date: { gte: since } },
    orderBy: { date: "desc" },
  });
  const urls = new Set<string>();
  for (const r of rows) {
    urls.add(r.url);
    try {
      for (const u of JSON.parse(r.allUrls) as string[]) urls.add(u);
    } catch {
      /* ignore */
    }
  }
  return { urls, titles: rows.map((r) => r.title) };
}

/** Hard dedup: drop any candidate whose URL was already published (SPEC §4.3). */
export function hardFilter<T extends { url: string }>(
  candidates: T[],
  knownUrls: Set<string>,
): T[] {
  const seenThisRun = new Set<string>();
  return candidates.filter((c) => {
    if (!c.url || knownUrls.has(c.url) || seenThisRun.has(c.url)) return false;
    seenThisRun.add(c.url);
    return true;
  });
}

/** Append the published articles to the dedup index. */
export async function recordPublished(records: DedupRecord[]): Promise<void> {
  for (const r of records) {
    if (!r.url) continue;
    await prisma.dedupEntry.upsert({
      where: { url: r.url },
      create: {
        date: r.date,
        title: r.title,
        url: r.url,
        allUrls: JSON.stringify(r.allUrls ?? [r.url]),
        tier: r.tier,
      },
      update: {},
    });
  }
}

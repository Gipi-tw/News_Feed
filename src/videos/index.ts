import { prisma } from "../lib/db";
import type { DigestConfig } from "../lib/types";
import { listChannelVideos } from "./youtube";
import { fetchTranscript, supadataAvailable, supadataCredits } from "./supadata";
import { summarizeVideo } from "./summarize";

// 🎬 影音重點, run with the daily collection: find new long uploads on the
// subscribed channels, fetch transcripts (Supadata, 1 point each) within a
// daily allowance that spreads the month's points evenly, and summarize them.
// Doesn't count toward the 45 articles.

type Log = (m: string) => void;

export interface VideoRunResult {
  found: number;
  summarized: number;
  noTranscript: number;
  skippedBudget: number;
  failed: number;
  errors: { source: string; error: string }[];
  budgetNote: string;
}

const TRANSCRIPT_RETENTION_DAYS = 14;
const DAY = 86_400_000;

/** Days left in the current calendar month in `timeZone`, today included. */
export function daysLeftInMonth(timeZone: string, now = new Date()): number {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now).split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return daysInMonth - d + 1;
}

/** Spread the remaining points over the rest of the month; never go below 1/day while any remain. */
export function dailyAllowance(remaining: number, daysLeft: number): number {
  return remaining > 0 ? Math.ceil(remaining / Math.max(1, daysLeft)) : 0;
}

export async function runVideos(cfg: DigestConfig, interestProfile: string, log: Log): Promise<VideoRunResult | null> {
  const vc = cfg.videos;
  if (!vc?.channels.length) return null;
  const result: VideoRunResult = {
    found: 0, summarized: 0, noTranscript: 0, skippedBudget: 0, failed: 0, errors: [], budgetNote: "",
  };
  const now = Date.now();
  const since = now - vc.lookbackDays * DAY;

  // 1. New long uploads.
  for (const ch of vc.channels) {
    try {
      const vids = (await listChannelVideos(ch.handle)).filter(
        (v) => v.durationSec >= vc.minMinutes * 60 && v.publishedAt && v.publishedAt.getTime() >= since,
      );
      if (vids.length) {
        const known = new Set(
          (await prisma.video.findMany({ where: { id: { in: vids.map((v) => v.id) } }, select: { id: true } })).map((r) => r.id),
        );
        const fresh = vids.filter((v) => !known.has(v.id));
        if (fresh.length) {
          await prisma.video.createMany({
            data: fresh.map((v) => ({
              id: v.id, channelKey: ch.key, channelName: ch.name, title: v.title,
              durationSec: v.durationSec, publishedAt: v.publishedAt,
            })),
          });
          result.found += fresh.length;
        }
      }
    } catch (e) {
      result.errors.push({ source: `yt:${ch.key}`, error: (e instanceof Error ? e.message : String(e)).slice(0, 120) });
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // 2. How many transcripts we can afford today.
  let allowed = 0;
  if (!supadataAvailable()) {
    result.budgetNote = "沒有設定 SUPADATA_API_KEY，影片只列標題";
  } else {
    const credits = await supadataCredits();
    if (!credits) {
      result.budgetNote = "讀不到 Supadata 額度，今天先不抓逐字稿";
    } else {
      const remaining = credits.max - credits.used - vc.reserveCredits;
      const doneToday = await prisma.video.count({ where: { transcribedAt: { gte: new Date(now - 20 * 3_600_000) } } });
      allowed = Math.max(0, dailyAllowance(remaining, daysLeftInMonth(cfg.timezone)) - doneToday);
      result.budgetNote = `Supadata ${credits.plan}：本期已用 ${credits.used}/${credits.max} 點，今天可再抓 ${allowed} 支`;
    }
  }

  // 3. Newest first. Videos that already have a transcript (an earlier summary
  //    attempt failed) are re-summarized without spending a point.
  const pending = await prisma.video.findMany({ where: { status: "new" }, orderBy: { publishedAt: "desc" } });
  for (const v of pending) {
    let lines: [number, string][] | null = v.transcript ? (JSON.parse(v.transcript) as [number, string][]) : null;
    if (!lines) {
      if (allowed <= 0) continue;
      allowed--;
      const t = await fetchTranscript(v.id, vc.transcriptLang);
      if (t.status === "unavailable") {
        await prisma.video.update({ where: { id: v.id }, data: { status: "no_transcript", transcribedAt: new Date() } });
        result.noTranscript++;
        continue;
      }
      if (t.status === "limit") {
        result.budgetNote += `；Supadata 回報額度用完（${t.error}）`;
        allowed = 0;
        continue;
      }
      if (t.status === "error") {
        await prisma.video.update({ where: { id: v.id }, data: { error: t.error } });
        result.errors.push({ source: `supadata:${v.id}`, error: t.error });
        continue;
      }
      lines = t.lines;
      await prisma.video.update({
        where: { id: v.id },
        data: { transcript: JSON.stringify(lines), transcribedAt: new Date(), error: null },
      });
    }
    try {
      const summary = await summarizeVideo({
        title: v.title, channelName: v.channelName, durationSec: v.durationSec, lines, interestProfile,
      });
      await prisma.video.update({ where: { id: v.id }, data: { status: "summarized", summary: JSON.stringify(summary), error: null } });
      result.summarized++;
      log(`🎬 摘要完成：${v.channelName}｜${v.title.slice(0, 40)}`);
    } catch (e) {
      const error = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      await prisma.video.update({ where: { id: v.id }, data: { error } });
      result.errors.push({ source: `summary:${v.id}`, error });
    }
  }

  // 4. Uploads that waited past the look-back window without a transcript:
  //    stop waiting; the digest lists them as not summarized.
  const expired = await prisma.video.updateMany({
    where: { status: "new", transcript: null, publishedAt: { lt: new Date(since) } },
    data: { status: "skipped_budget" },
  });
  result.skippedBudget = expired.count;
  const stale = await prisma.video.updateMany({
    where: { status: "new", createdAt: { lt: new Date(now - 7 * DAY) } },
    data: { status: "failed" },
  });
  result.failed = stale.count;

  // 5. Transcripts are bulky; keep summaries, drop old transcripts.
  await prisma.video.updateMany({
    where: { transcribedAt: { lt: new Date(now - TRANSCRIPT_RETENTION_DAYS * DAY) }, transcript: { not: null } },
    data: { transcript: null },
  });
  return result;
}

const SHOWABLE = ["summarized", "no_transcript", "skipped_budget", "failed"];

/** Videos waiting to appear in the next digest (summarized or given up on). */
export async function unshownVideoCounts(): Promise<{ summarized: number; other: number }> {
  const [summarized, all] = await Promise.all([
    prisma.video.count({ where: { digestId: null, status: "summarized" } }),
    prisma.video.count({ where: { digestId: null, status: { in: SHOWABLE } } }),
  ]);
  return { summarized, other: all - summarized };
}

/** Put every not-yet-shown finished video into this digest. */
export async function attachVideos(digestId: string): Promise<void> {
  await prisma.video.updateMany({ where: { digestId: null, status: { in: SHOWABLE } }, data: { digestId } });
}

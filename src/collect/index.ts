import { prisma } from "../lib/db";
import { getDigestConfig, getInterestProfile } from "../lib/config";
import type { DigestConfig, FeedSource, GoogleNewsQuery, TierKey } from "../lib/types";
import { parseFeed, type FeedEntry } from "./feed";
import { googleNewsSearchUrl, isGoogleNewsLink } from "./gnews";
import { keywordMatcher, tierHints } from "./prefilter";
import { publisherBlocker } from "./blocklist";
import { scoreItems } from "./score";
import { usage } from "../lib/anthropic";
import { runVideos, type VideoRunResult } from "../videos";

// The collector: every few hours, pull every configured RSS feed and Google
// News query, store new items (deduped by link), keyword-prefilter them, and
// have Haiku score the survivors. The 08:00 digest then picks from these
// scored items instead of searching from scratch.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const FEED_CONCURRENCY = 4;
const GOOGLE_NEWS_GAP_MS = 700; // be gentle with news.google.com

type Log = (m: string) => void;

export interface CollectResult {
  runId: string;
  fetched: number;
  inserted: number;
  scored: number;
  errors: { source: string; error: string }[];
  scoreFailure: string;
}

interface NewItem {
  link: string;
  url: string | null;
  title: string;
  summary: string;
  sourceKey: string;
  sourceName: string;
  publishedAt: Date | null;
  hints: TierKey[];
}

async function fetchFeed(url: string, timezone?: string): Promise<FeedEntry[]> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text(), url, timezone);
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 120);

/** Run every configured source. Skips if a collection succeeded < `skipIfFreshMinutes` ago. */
export async function runCollect(opts: { log?: Log; skipIfFreshMinutes?: number } = {}): Promise<CollectResult | null> {
  const cfg = await getDigestConfig();
  if (!cfg.sources) return null;
  if (opts.skipIfFreshMinutes) {
    const recent = await prisma.collectRun.findFirst({
      // Only full collections count (a digest-time top-up search is not one).
      where: {
        status: "success",
        message: { startsWith: "排程收集" },
        finishedAt: { gte: new Date(Date.now() - opts.skipIfFreshMinutes * 60_000) },
      },
    });
    if (recent) return null;
  }
  return collect(cfg, cfg.sources.feeds, cfg.sources.googleNews, opts.log, "排程收集", true);
}

/** Run ad-hoc Google News queries (digest-time top-up for a short tier). */
export async function collectQueries(queries: GoogleNewsQuery[], log?: Log): Promise<CollectResult | null> {
  const cfg = await getDigestConfig();
  if (!cfg.sources || !queries.length) return null;
  return collect(cfg, [], queries, log, "補搜尋");
}

async function collect(
  cfg: DigestConfig,
  feeds: FeedSource[],
  queries: GoogleNewsQuery[],
  log: Log = (m) => console.log(`[collect] ${m}`),
  label: string,
  withVideos = false,
): Promise<CollectResult> {
  const src = cfg.sources!;
  const run = await prisma.collectRun.create({ data: { status: "running", message: label } });
  const errors: CollectResult["errors"] = [];
  const perSource: Record<string, number> = {};
  const match = keywordMatcher(src.keywords);
  const blocked = publisherBlocker(src.blockedPublishers);
  const oldest = Date.now() - src.retentionDays * 86_400_000;
  const found: NewItem[] = [];

  const add = (sourceKey: string, sourceName: string, tiers: TierKey[] | undefined, entries: FeedEntry[]) => {
    perSource[sourceKey] = entries.length;
    for (const e of entries) {
      if (e.publishedAt && e.publishedAt.getTime() < oldest) continue;
      if (blocked(e.publisher, e.link)) continue; // never stored, so never scored
      found.push({
        link: e.link,
        url: isGoogleNewsLink(e.link) ? null : e.link,
        title: e.title.slice(0, 300),
        summary: e.summary,
        sourceKey,
        sourceName: e.publisher || sourceName,
        publishedAt: e.publishedAt,
        hints: tierHints(tiers, `${e.title} ${e.summary}`, match),
      });
    }
  };

  try {
    // 1. Feeds, a few at a time.
    for (let i = 0; i < feeds.length; i += FEED_CONCURRENCY) {
      await Promise.all(
        feeds.slice(i, i + FEED_CONCURRENCY).map(async (f) => {
          try {
            add(f.key, f.name, f.tiers, await fetchFeed(f.url, f.timezone));
          } catch (e) {
            errors.push({ source: f.key, error: errText(e) });
          }
        }),
      );
    }
    // 2. Google News queries, one at a time.
    for (const q of queries) {
      try {
        const entries = await fetchFeed(googleNewsSearchUrl(q));
        add(q.key, q.name, q.tiers, entries.slice(0, src.maxItemsPerGoogleNewsQuery));
      } catch (e) {
        errors.push({ source: q.key, error: errText(e) });
      }
      await new Promise((r) => setTimeout(r, GOOGLE_NEWS_GAP_MS));
    }
    log(`抓到 ${found.length} 則（${Object.keys(perSource).length} 個來源，${errors.length} 個失敗）`);

    // 3. Store only links we haven't seen.
    const unique = [...new Map(found.map((f) => [f.link, f])).values()];
    const known = new Set<string>();
    for (let i = 0; i < unique.length; i += 400) {
      const rows = await prisma.item.findMany({
        where: { link: { in: unique.slice(i, i + 400).map((u) => u.link) } },
        select: { link: true },
      });
      rows.forEach((r) => known.add(r.link));
    }
    const fresh = unique.filter((u) => !known.has(u.link));
    if (fresh.length) {
      await prisma.item.createMany({
        data: fresh.map((f) => ({
          ...f,
          hints: JSON.stringify(f.hints),
          // No tier hint → general-feed item that matched nothing: never scored.
          tier: f.hints.length ? null : "none",
        })),
      });
    }

    // 4. Score unscored, hinted, recent items.
    const since = new Date(Date.now() - cfg.search.freshnessHours * 2 * 3_600_000);
    const toScore = await prisma.item.findMany({
      where: {
        score: null,
        tier: null,
        OR: [{ publishedAt: { gte: since } }, { publishedAt: null, createdAt: { gte: since } }],
      },
      select: { id: true, title: true, summary: true, sourceName: true, hints: true },
      take: 1500,
    });
    let scored = 0;
    // Scoring (and video summaries) are the LLM spend here; record it on this
    // run so scheduled collections show up in the cost log, not just digests.
    const costBefore = usage.costUSD;
    const tokensBefore = { input: usage.inputTokens, output: usage.outputTokens, cacheRead: usage.cacheReadInputTokens };
    let scoreFailure = "";
    const profile = toScore.length || withVideos ? await getInterestProfile() : "";
    if (toScore.length) {
      const { results, failedBatches, lastError } = await scoreItems(
        toScore.map((t) => ({ ...t, hints: JSON.parse(t.hints) as string[] })),
        cfg,
        profile,
      );
      for (let i = 0; i < results.length; i += 200) {
        await prisma.$transaction(
          results.slice(i, i + 200).map((r) => prisma.item.update({ where: { id: r.id }, data: { tier: r.tier, score: r.score } })),
        );
      }
      scored = results.length;
      // Surface it: "評分 0 則" alone hid a dead API key / empty credit balance.
      if (failedBatches) scoreFailure = `評分失敗 ${failedBatches} 批（${lastError}）`;
    }

    // 🎬 New long uploads on the subscribed channels (daily collection only).
    let videos: VideoRunResult | null = null;
    if (withVideos) {
      try {
        videos = await runVideos(cfg, profile, log);
      } catch (e) {
        errors.push({ source: "videos", error: errText(e) });
      }
    }
    const videoNote = videos
      ? `；影片：新 ${videos.found}、摘要 ${videos.summarized}${videos.timestamps.total ? `（時間校正 ${videos.timestamps.anchored}/${videos.timestamps.total}）` : ""}${videos.noTranscript ? `、無字幕 ${videos.noTranscript}` : ""}${videos.skippedBudget ? `、額度不足略過 ${videos.skippedBudget}` : ""}（${videos.budgetNote}）`
      : "";

    const scoreCost = Number((usage.costUSD - costBefore).toFixed(4));
    const scoreUsage = {
      inputTokens: usage.inputTokens - tokensBefore.input,
      outputTokens: usage.outputTokens - tokensBefore.output,
      cacheReadInputTokens: usage.cacheReadInputTokens - tokensBefore.cacheRead,
    };

    // 5. Retention.
    await prisma.item.deleteMany({ where: { createdAt: { lt: new Date(oldest) } } });

    if (videos?.errors.length) errors.push(...videos.errors);
    const result = { runId: run.id, fetched: found.length, inserted: fresh.length, scored, errors, scoreFailure };
    await prisma.collectRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        message: `${label}：新增 ${fresh.length} 則、評分 ${scored}/${toScore.length} 則${errors.length ? `、${errors.length} 個來源失敗` : ""}｜估算 US$${scoreCost.toFixed(4)}${scoreFailure ? `；${scoreFailure}` : ""}${videoNote}`.slice(0, 400),
        detail: JSON.stringify({ perSource, errors, scoreFailure, videos, scoreUsage, estimatedCostUSD: scoreCost }),
      },
    });
    log(`新增 ${fresh.length} 則，評分 ${scored} 則`);
    return result;
  } catch (err) {
    await prisma.collectRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date(), message: errText(err), detail: JSON.stringify({ perSource, errors }) },
    });
    throw err;
  }
}

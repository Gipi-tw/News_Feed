import { prisma } from "./db";
import { getDigestConfig } from "./config";
import type { LintReport, TierConfig, TierKey } from "./types";
import type { VideoSummary } from "../videos/summarize";

export interface ArticleView {
  id: string;
  tier: TierKey;
  position: number;
  title: string;
  sourceName: string;
  sourceDate: string;
  factSummary: string;
  opinionHook: string;
  urls: string[];
  tags: string[];
  myComment: string;
  commentStatus: "draft" | "edited" | "published";
  lintReport: LintReport | null;
}

export interface DigestView {
  id: string;
  date: string;
  edition: number;
  title: string;
  status: string;
  createdAt: Date;
  notes: string[];
  articles: ArticleView[];
  videos: VideoView[];
}

export interface VideoView {
  id: string;
  channelName: string;
  title: string;
  durationSec: number;
  publishedAt: Date | null;
  status: string; // summarized | no_transcript | skipped_budget | failed
  summary: VideoSummary | null;
}

async function videosFor(digestId: string): Promise<VideoView[]> {
  const rows = await prisma.video.findMany({
    where: { digestId },
    orderBy: [{ status: "desc" }, { publishedAt: "desc" }], // "summarized" sorts before the others
    select: { id: true, channelName: true, title: true, durationSec: true, publishedAt: true, status: true, summary: true },
  });
  return rows.map((r) => {
    let summary: VideoSummary | null = null;
    try { summary = r.summary ? (JSON.parse(r.summary) as VideoSummary) : null; } catch { summary = null; }
    return { ...r, summary };
  });
}

function parseArticle(a: {
  id: string;
  tier: string;
  position: number;
  title: string;
  sourceName: string;
  sourceDate: string;
  factSummary: string;
  opinionHook: string;
  urls: string;
  tags: string;
  myComment: string;
  commentStatus: string;
  lintReport: string | null;
}): ArticleView {
  let urls: string[] = [];
  let lint: LintReport | null = null;
  try { urls = JSON.parse(a.urls); } catch { urls = []; }
  try { lint = a.lintReport ? JSON.parse(a.lintReport) : null; } catch { lint = null; }
  return {
    id: a.id,
    tier: a.tier as TierKey,
    position: a.position,
    title: a.title,
    sourceName: a.sourceName,
    sourceDate: a.sourceDate,
    factSummary: a.factSummary,
    opinionHook: a.opinionHook,
    urls,
    tags: parseList(a.tags),
    myComment: a.myComment,
    commentStatus: a.commentStatus as ArticleView["commentStatus"],
    lintReport: lint,
  };
}

function parseList(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function toView(d: {
  id: string; date: string; edition: number; title: string; status: string;
  createdAt: Date; notes: string; articles: Parameters<typeof parseArticle>[0][];
}): DigestView {
  return {
    id: d.id, date: d.date, edition: d.edition, title: d.title,
    status: d.status, createdAt: d.createdAt, notes: parseList(d.notes),
    articles: d.articles.map(parseArticle).sort((a, b) => a.position - b.position),
    videos: [], // filled by the loaders below
  };
}

export async function getLatestDigest(): Promise<DigestView | null> {
  const d = await prisma.digest.findFirst({
    orderBy: [{ date: "desc" }, { edition: "desc" }],
    include: { articles: true },
  });
  return d ? { ...toView(d), videos: await videosFor(d.id) } : null;
}

export async function getDigestById(id: string): Promise<DigestView | null> {
  const d = await prisma.digest.findUnique({ where: { id }, include: { articles: true } });
  return d ? { ...toView(d), videos: await videosFor(d.id) } : null;
}

export async function listDigests(): Promise<
  { id: string; date: string; edition: number; count: number; createdAt: Date }[]
> {
  const rows = await prisma.digest.findMany({
    orderBy: [{ date: "desc" }, { edition: "desc" }],
    include: { _count: { select: { articles: true } } },
  });
  return rows.map((r) => ({
    id: r.id, date: r.date, edition: r.edition, count: r._count.articles, createdAt: r.createdAt,
  }));
}

export async function searchArticles(q: string): Promise<
  (ArticleView & { digestId: string; date: string; edition: number })[]
> {
  if (!q.trim()) return [];
  const rows = await prisma.article.findMany({
    where: {
      OR: [
        { title: { contains: q } },
        { factSummary: { contains: q } },
        { opinionHook: { contains: q } },
        { myComment: { contains: q } },
      ],
    },
    include: { digest: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((r) => ({
    ...parseArticle(r),
    digestId: r.digestId,
    date: r.digest.date,
    edition: r.digest.edition,
  }));
}

// Tiers that no longer exist in the config but appear in old digests.
const LEGACY_TIERS: TierConfig[] = [
  {
    key: "ai_work", emoji: "🤖", label: "AI × 工作方式", subtitle: "Agent・組織・人才・未來工作",
    count: 8, tierClass: "tier1", scope: "", queries: [],
  },
];

/** Tier metadata (emoji/label/class) for rendering: active config, then legacy. */
export async function getTierMeta(): Promise<TierConfig[]> {
  const cfg = await getDigestConfig();
  const active = new Set(cfg.tiers.map((t) => t.key));
  return [...cfg.tiers, ...LEGACY_TIERS.filter((t) => !active.has(t.key))];
}

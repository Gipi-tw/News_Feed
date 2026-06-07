import { prisma } from "./db";
import { getDigestConfig } from "./config";
import type { LintReport, TierKey } from "./types";

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
  articles: ArticleView[];
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
    myComment: a.myComment,
    commentStatus: a.commentStatus as ArticleView["commentStatus"],
    lintReport: lint,
  };
}

function toView(d: {
  id: string; date: string; edition: number; title: string; status: string;
  createdAt: Date; articles: Parameters<typeof parseArticle>[0][];
}): DigestView {
  return {
    id: d.id, date: d.date, edition: d.edition, title: d.title,
    status: d.status, createdAt: d.createdAt,
    articles: d.articles.map(parseArticle).sort((a, b) => a.position - b.position),
  };
}

export async function getLatestDigest(): Promise<DigestView | null> {
  const d = await prisma.digest.findFirst({
    orderBy: [{ date: "desc" }, { edition: "desc" }],
    include: { articles: true },
  });
  return d ? toView(d) : null;
}

export async function getDigestById(id: string): Promise<DigestView | null> {
  const d = await prisma.digest.findUnique({ where: { id }, include: { articles: true } });
  return d ? toView(d) : null;
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

/** Tier metadata (emoji/label/class) for rendering, from the active config. */
export async function getTierMeta() {
  const cfg = await getDigestConfig();
  return cfg.tiers;
}

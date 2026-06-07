import { prisma } from "../lib/db";
import type { BuiltArticle } from "../lib/types";
import { recordPublished } from "./dedup";

/** Next edition number for a given date (1 if none yet). */
export async function nextEdition(date: string): Promise<number> {
  const last = await prisma.digest.findFirst({
    where: { date },
    orderBy: { edition: "desc" },
  });
  return (last?.edition ?? 0) + 1;
}

export async function saveDigest(opts: {
  date: string;
  edition: number;
  title: string;
  articles: BuiltArticle[];
}): Promise<string> {
  const { date, edition, title, articles } = opts;

  const digest = await prisma.digest.create({
    data: {
      date,
      edition,
      title,
      status: "complete",
      articles: {
        create: articles.map((a) => ({
          tier: a.tier,
          position: a.position,
          title: a.title,
          sourceName: a.sourceName,
          sourceDate: a.sourceDate,
          factSummary: a.factSummary,
          opinionHook: a.opinionHook,
          urls: JSON.stringify(a.urls),
          myComment: a.myComment,
          commentStatus: "draft",
          lintReport: JSON.stringify(a.lintReport),
        })),
      },
    },
  });

  // Update the dedup index with everything we just published.
  await recordPublished(
    articles.map((a) => ({
      date,
      title: a.title,
      url: a.urls[0],
      allUrls: a.urls,
      tier: a.tier,
    })),
  );

  return digest.id;
}

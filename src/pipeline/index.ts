import { prisma } from "../lib/db";
import { getDigestConfig, getInterestProfile, getStyleGuide } from "../lib/config";
import { todayInTz } from "../lib/date";
import { mapPool } from "../lib/pool";
import type { BuiltArticle, Candidate, SearchHit, TierKey } from "../lib/types";
import { runSearches } from "../lib/search";
import { enrichCandidates } from "./fetch";
import { getRecentEntries, hardFilter } from "./dedup";
import { selectForTier } from "./select";
import { summarizeTier } from "./summarize";
import { generateComment } from "./comment";
import { nextEdition, saveDigest } from "./assemble";
import { notifyDigestReady } from "./notify";

export interface RunResult {
  digestId: string;
  date: string;
  edition: number;
  count: number;
  failures: number;
  byTier: Record<string, number>;
}

type Logger = (msg: string) => void;

/**
 * The full daily pipeline (SPEC §1): search → select → fetch → summarize →
 * comment (+lint retry) → assemble → dedup index → notify.
 */
export async function runDigest(opts?: {
  trigger?: "cron" | "manual";
  log?: Logger;
}): Promise<RunResult> {
  const trigger = opts?.trigger ?? "manual";
  const log: Logger = opts?.log ?? ((m) => console.log(`[pipeline] ${m}`));

  const run = await prisma.runLog.create({ data: { trigger, status: "running" } });
  const detail: Record<string, unknown> = {};

  try {
    const cfg = await getDigestConfig();
    const [interestProfile, styleGuide] = await Promise.all([
      getInterestProfile(),
      getStyleGuide(),
    ]);
    const today = todayInTz(cfg.timezone);
    const edition = await nextEdition(today);
    log(`日期 ${today}｜第 ${edition} 期｜trigger=${trigger}`);

    // 1. Search every query across every tier.
    const hits = await runSearches(cfg);
    log(`搜尋取得 ${hits.length} 則候選`);
    detail.rawHits = hits.length;

    // 2. Hard dedup (URL) against the last `windowDays`.
    const { urls: knownUrls, titles: recentTitles } = await getRecentEntries(
      today,
      cfg.dedup.windowDays,
    );
    const fresh = hardFilter(hits, knownUrls);
    log(`URL 去重後剩 ${fresh.length} 則（已排除 ${hits.length - fresh.length}）`);

    // 3. Select per tier (snippet-based) — parallel.
    const byTierHits = new Map<TierKey, SearchHit[]>();
    for (const h of fresh) {
      const t = (h.tier ?? "tier2") as TierKey;
      (byTierHits.get(t) ?? byTierHits.set(t, []).get(t)!).push(h);
    }
    const selections = await Promise.all(
      cfg.tiers.map((tier) =>
        selectForTier({
          tier,
          candidates: byTierHits.get(tier.key) ?? [],
          recentTitles,
          interestProfile,
          today,
          cfg,
        }).then((picked) => ({ tier, picked })),
      ),
    );
    const selectedCount = selections.reduce((n, s) => n + s.picked.length, 0);
    log(`選文完成：共選 ${selectedCount} 則`);

    // 4. Fetch full text only for the winners.
    const allPicked = selections.flatMap((s) => s.picked);
    const enriched = await enrichCandidates(allPicked);
    const enrichedByUrl = new Map<string, Candidate>(enriched.map((c) => [c.url, c]));

    // 5. Summarize per tier — parallel.
    const summaries = await Promise.all(
      selections.map((s) =>
        summarizeTier({
          tier: s.tier,
          selected: s.picked.map((h) => enrichedByUrl.get(h.url) ?? { ...h }),
          today,
        }),
      ),
    );
    const articlesFlat = summaries.flat();
    log(`摘要完成：${articlesFlat.length} 篇`);

    // 6. Generate comments with lint+retry — bounded concurrency.
    const built = await mapPool(articlesFlat, 4, async (article) => {
      const { comment, lint } = await generateComment({ article, styleGuide, cfg, today });
      return { article, comment, lint };
    });

    // 7. Assign positions per tier and build final records.
    const posCounter = new Map<TierKey, number>();
    const finalArticles: BuiltArticle[] = built.map((b) => {
      const pos = (posCounter.get(b.article.tier) ?? 0) + 1;
      posCounter.set(b.article.tier, pos);
      return {
        ...b.article,
        position: pos,
        myComment: b.comment,
        lintReport: b.lint,
      };
    });

    const failures = finalArticles.filter((a) => !a.lintReport.ok).length;
    const byTier: Record<string, number> = {};
    for (const a of finalArticles) byTier[a.tier] = (byTier[a.tier] ?? 0) + 1;
    detail.byTier = byTier;
    detail.lintFailures = failures;
    log(`評論完成：${finalArticles.length} 篇（${failures} 篇未過 lint）`);

    // 8. Persist + dedup index.
    const digestId = await saveDigest({
      date: today,
      edition,
      title: `內容摘要日報`,
      articles: finalArticles,
    });

    await prisma.runLog.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        digestId,
        message: `${finalArticles.length} 篇（${failures} 未過 lint）`,
        detail: JSON.stringify(detail),
      },
    });

    // 9. Notify (optional).
    await notifyDigestReady({
      date: today,
      edition,
      count: finalArticles.length,
      digestId,
      failures,
    });

    log(`完成 ✓ digestId=${digestId}`);
    return { digestId, date: today, edition, count: finalArticles.length, failures, byTier };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.runLog.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date(), message, detail: JSON.stringify(detail) },
    });
    log(`失敗 ✗ ${message}`);
    throw err;
  }
}

import { prisma } from "../lib/db";
import { env } from "../lib/env";
import { getDigestConfig, getInterestProfile, getStyleGuide } from "../lib/config";
import { todayInTz } from "../lib/date";
import { mapPool } from "../lib/pool";
import type { BuiltArticle, Candidate, SearchHit, SelectedArticle, TierKey } from "../lib/types";
import { runSearches } from "../lib/search";
import { enrichCandidates } from "./fetch";
import { getRecentEntries, hardFilter } from "./dedup";
import { selectForTier } from "./select";
import { summarizeTier } from "./summarize";
import { researchTier } from "./research";
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
  runId?: string;
}): Promise<RunResult> {
  const trigger = opts?.trigger ?? "manual";
  const log: Logger = opts?.log ?? ((m) => console.log(`[pipeline] ${m}`));

  // Reuse a pre-created RunLog (async trigger) or create one (CLI/cron sync).
  const runId =
    opts?.runId ??
    (await prisma.runLog.create({ data: { trigger, status: "running" } })).id;
  const detail: Record<string, unknown> = {};

  // Persist progress to RunLog.message so the UI can poll a live stage readout.
  const progress = async (m: string) => {
    log(m);
    try {
      await prisma.runLog.update({ where: { id: runId }, data: { message: m } });
    } catch {
      /* ignore */
    }
  };

  try {
    const cfg = await getDigestConfig();
    const [interestProfile, styleGuide] = await Promise.all([
      getInterestProfile(),
      getStyleGuide(),
    ]);
    const today = todayInTz(cfg.timezone);
    const edition = await nextEdition(today);
    await progress(`開始產生 ${today} 第 ${edition} 期`);

    // Dedup index (recent published) — needed by both search modes.
    const { urls: knownUrls, titles: recentTitles } = await getRecentEntries(
      today,
      cfg.dedup.windowDays,
    );

    const mode = env.searchProviderOverride || cfg.search.provider;
    let articlesFlat: SelectedArticle[];

    if (mode === "claude") {
      // ── Claude-native path: web_search does search+select+summarize per tier.
      await progress("搜尋中（Claude web_search）…");
      // Sequential per tier: web_search payloads are token-heavy, and running
      // tiers in parallel exceeds the org's per-minute input-token limit.
      const perTier: SelectedArticle[][] = [];
      for (let i = 0; i < cfg.tiers.length; i++) {
        const tier = cfg.tiers[i];
        const arts = await researchTier({ tier, recentTitles, interestProfile, today, cfg });
        perTier.push(arts);
        await progress(
          `已完成 ${i + 1}/${cfg.tiers.length} 分區（${tier.label.split("：")[0]}，${arts.length} 篇）`,
        );
      }
      // Backstop URL hard-dedup against the last `windowDays` (SPEC §4.3).
      articlesFlat = perTier
        .flat()
        .filter((a) => a.urls[0] && !knownUrls.has(a.urls[0]));
      detail.mode = "claude";
      await progress(`研究完成：${articlesFlat.length} 篇，開始生成評論…`);
    } else {
      // ── Third-party provider path (Brave/Serper/mock).
      const hits = await runSearches(cfg);
      log(`搜尋取得 ${hits.length} 則候選`);
      detail.rawHits = hits.length;

      const fresh = hardFilter(hits, knownUrls);
      log(`URL 去重後剩 ${fresh.length} 則（已排除 ${hits.length - fresh.length}）`);

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
      log(`選文完成：共選 ${selections.reduce((n, s) => n + s.picked.length, 0)} 則`);

      const allPicked = selections.flatMap((s) => s.picked);
      const enriched = await enrichCandidates(allPicked);
      const enrichedByUrl = new Map<string, Candidate>(enriched.map((c) => [c.url, c]));

      const summaries = await Promise.all(
        selections.map((s) =>
          summarizeTier({
            tier: s.tier,
            selected: s.picked.map((h) => enrichedByUrl.get(h.url) ?? { ...h }),
            today,
          }),
        ),
      );
      articlesFlat = summaries.flat();
      detail.mode = mode;
      log(`摘要完成：${articlesFlat.length} 篇`);
    }

    // 6. Generate comments with lint+retry — low concurrency to respect the
    //    org's per-minute input-token limit.
    const built = await mapPool(articlesFlat, 2, async (article) => {
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
    await progress(`評論完成：${finalArticles.length} 篇（${failures} 篇未過 lint），存檔中…`);

    // 8. Persist + dedup index.
    const digestId = await saveDigest({
      date: today,
      edition,
      title: `內容摘要日報`,
      articles: finalArticles,
    });

    await prisma.runLog.update({
      where: { id: runId },
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
      where: { id: runId },
      data: { status: "failed", finishedAt: new Date(), message, detail: JSON.stringify(detail) },
    });
    log(`失敗 ✗ ${message}`);
    throw err;
  }
}

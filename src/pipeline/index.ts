import { prisma } from "../lib/db";
import { env } from "../lib/env";
import { getDigestConfig, getInterestProfile } from "../lib/config";
import { todayInTz } from "../lib/date";
import type { BuiltArticle, Candidate, SearchHit, SelectedArticle, TierConfig, TierKey } from "../lib/types";
import { runSearches } from "../lib/search";
import { enrichCandidates } from "./fetch";
import { getRecentEntries, hardFilter } from "./dedup";
import { selectForTier } from "./select";
import { summarizeTier } from "./summarize";
import { researchTier } from "./research";
import { enforceQuotas } from "./quota";
import { buildNotes, type TierOutcome } from "./notes";
import { collectedCandidates, markUsed, resolveLinks } from "./candidates";
import { dropSameEvent, findSameEvent, type EventItem } from "./same-event";
import { publisherBlocker } from "../collect/blocklist";
import { runCollect } from "../collect";
import { attachVideos, unshownVideoCounts } from "../videos";
import { nextEdition, saveDigest } from "./assemble";
import { sendDigestEmail, sendFailureEmail } from "./notify";
import { estimateCostUSD, resetUsage, usage } from "../lib/anthropic";

export interface RunResult {
  digestId: string;
  date: string;
  edition: number;
  count: number;
  failures: number;
  byTier: Record<string, number>;
}

type Logger = (msg: string) => void;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** Ranked, tagged pool for one tier (before quota enforcement). */
interface TierPool<T> {
  tier: TierConfig;
  ranked: T[];
  shortfallNote: string;
  error?: string;
  deduped?: number; // dropped as the same event as a better-ranked pick
}

/**
 * The full daily pipeline (SPEC §1): search → rank+tag per tier → enforce
 * quotas → fetch → summarize → assemble (+footer notes) → dedup index → notify.
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
  resetUsage(); // start cost accounting for this run

  // Persist progress to RunLog.message so the UI can poll a live stage readout.
  const progress = async (m: string) => {
    log(m);
    try {
      await prisma.runLog.update({ where: { id: runId }, data: { message: m } });
    } catch {
      /* ignore */
    }
  };

  let runDate = ""; // for the failure email
  try {
    const cfg = await getDigestConfig();
    // styleGuide is no longer needed (pure-curation digest writes no comment).
    const interestProfile = await getInterestProfile();
    const today = todayInTz(cfg.timezone);
    runDate = today;
    const edition = await nextEdition(today);
    await progress(`開始產生 ${today} 第 ${edition} 期`);

    // Dedup index (recent published) — needed by both search modes.
    const { urls: knownUrls, titles: recentTitles } = await getRecentEntries(
      today,
      cfg.dedup.windowDays,
    );

    const mode = env.searchProviderOverride || cfg.search.provider;
    let articlesFlat: SelectedArticle[];
    let outcomes: TierOutcome[];
    const itemByUrl = new Map<string, string>(); // collected mode: url → Item id

    if (mode === "claude") {
      // ── Claude-native path: web_search does search+select+summarize per tier.
      await progress("搜尋中（Claude web_search）…");
      // Sequential per tier: web_search payloads are token-heavy, and running
      // tiers in parallel exceeds the org's per-minute input-token limit.
      const pools: TierPool<SelectedArticle>[] = [];
      const blocked = publisherBlocker(cfg.sources?.blockedPublishers);
      for (let i = 0; i < cfg.tiers.length; i++) {
        const tier = cfg.tiers[i];
        try {
          const r = await researchTier({ tier, recentTitles, interestProfile, today, cfg });
          // Backstop URL hard-dedup against the last `windowDays` (SPEC §4.3),
          // and drop stale finds (web_search happily returns months-old pages).
          const ranked = r.ranked.filter(
            (a) =>
              a.urls[0] &&
              !knownUrls.has(a.urls[0]) &&
              !blocked(a.sourceName, a.urls[0]) &&
              isFresh(a.sourceDate, cfg.search.freshnessHours * 2),
          );
          pools.push({ tier, ranked, shortfallNote: r.shortfallNote });
        } catch (err) {
          log(`分區失敗（${tier.key}）：${errMsg(err)}`);
          pools.push({ tier, ranked: [], shortfallNote: "", error: errMsg(err) });
        }
        await progress(
          `已完成 ${i + 1}/${cfg.tiers.length} 分區（${tier.label.split("：")[0]}，候選 ${pools[i].ranked.length} 篇）`,
        );
      }
      assertSomeTierWorked(pools);
      await dropSameEventPicks(pools, (a) => ({ title: a.title, sourceName: a.sourceName, snippet: a.factSummary }), log, detail);

      const enforced = enforceQuotas(
        pools.map((p) => ({ key: p.tier.key, ranked: p.ranked, count: p.tier.count, rules: p.tier.rules })),
        cfg.globalRules,
      );
      articlesFlat = enforced.flatMap((r) => r.picked);
      outcomes = pools.map((p, i) => ({ ...p, ...enforced[i] }));
      detail.mode = "claude";
      await progress(`研究完成：${articlesFlat.length} 篇，存檔中…`);
    } else {
      const byTierHits = new Map<string, SearchHit[]>();
      if (mode === "collected") {
        // ── Collected path (default): RSS/Google News items, scored by the collector.
        await progress("收集最新文章…");
        await runCollect({ log, skipIfFreshMinutes: 12 * 60 });
        await progress("從收集到的文章挑候選…");
        for (const [k, v] of await collectedCandidates(cfg, knownUrls, log)) byTierHits.set(k, v);
        detail.candidates = Object.fromEntries([...byTierHits].map(([k, v]) => [k, v.length]));
      } else {
        // ── Third-party provider path (Brave/Serper/mock).
        const hits = await runSearches(cfg);
        log(`搜尋取得 ${hits.length} 則候選`);
        detail.rawHits = hits.length;

        const fresh = hardFilter(hits, knownUrls);
        log(`URL 去重後剩 ${fresh.length} 則（已排除 ${hits.length - fresh.length}）`);
        for (const h of fresh) {
          const t = (h.tier ?? "tier2") as TierKey;
          (byTierHits.get(t) ?? byTierHits.set(t, []).get(t)!).push(h);
        }
      }
      await progress("選文中…");
      // One tier at a time: the first call writes the cached system prompt
      // (full interest profile), the other four read it at 0.1× the price.
      const pools: TierPool<SearchHit & { tags: string[] }>[] = [];
      const selection: Record<string, string> = {};
      for (const tier of cfg.tiers) {
        try {
          const candidates = byTierHits.get(tier.key) ?? [];
          const s = await selectForTier({ tier, candidates, recentTitles, interestProfile, today, cfg });
          // Candidates → model picks → picks matched to a candidate (+ retries).
          selection[tier.key] = `${candidates.length}→${s.returned}→${s.ranked.length}${s.attempts > 1 ? `（重選 ${s.attempts - 1} 次）` : ""}`;
          log(`選文（${tier.key}）：候選 ${candidates.length}、模型選 ${s.returned}、對上 ${s.ranked.length}${s.attempts > 1 ? `，重選 ${s.attempts - 1} 次` : ""}`);
          pools.push({ tier, ranked: s.ranked.map((h) => ({ ...h, tags: h.tags ?? [] })), shortfallNote: s.shortfallNote });
        } catch (err) {
          log(`選文失敗（${tier.key}）：${errMsg(err)}`);
          pools.push({ tier, ranked: [], shortfallNote: "", error: errMsg(err) });
        }
      }
      detail.selection = selection;
      assertSomeTierWorked(pools);
      if (mode === "collected") {
        await progress("解析 Google News 原文連結…");
        await resolveLinks(pools, knownUrls, cfg.sources?.blockedPublishers);
      }
      await progress("檢查同一事件重複…");
      await dropSameEventPicks(pools, (h) => ({ title: h.title, sourceName: h.sourceName, snippet: h.snippet }), log, detail);

      const enforced = enforceQuotas(
        pools.map((p) => ({ key: p.tier.key, ranked: p.ranked, count: p.tier.count, rules: p.tier.rules })),
        cfg.globalRules,
      );
      for (const r of enforced) for (const h of r.picked) if (h.itemId) itemByUrl.set(h.url, h.itemId);
      log(`選文完成：共選 ${enforced.reduce((n, r) => n + r.picked.length, 0)} 則`);

      const allPicked = enforced.flatMap((r) => r.picked);
      const enriched = await enrichCandidates(allPicked);
      const enrichedByUrl = new Map<string, Candidate>(enriched.map((c) => [c.url, c]));

      const summaries = await Promise.all(
        pools.map(async (p, i) => {
          try {
            return await summarizeTier({
              tier: p.tier,
              selected: enforced[i].picked.map((h) => enrichedByUrl.get(h.url) ?? { ...h }),
              today,
            });
          } catch (err) {
            log(`摘要失敗（${p.tier.key}）：${errMsg(err)}`);
            p.error = errMsg(err);
            return [];
          }
        }),
      );
      articlesFlat = summaries.flat();
      outcomes = pools.map((p, i) => ({ ...p, ...enforced[i] }));
      detail.mode = mode;
      log(`摘要完成：${articlesFlat.length} 篇`);
    }

    // 6. Pure-curation digest: no comment/post draft is generated (the only
    //    stage that needed a high-end model). Assign positions per tier and
    //    build final records directly from the selected/summarized articles.
    const posCounter = new Map<TierKey, number>();
    const finalArticles: BuiltArticle[] = articlesFlat.map((article) => {
      const pos = (posCounter.get(article.tier) ?? 0) + 1;
      posCounter.set(article.tier, pos);
      return {
        ...article,
        position: pos,
        myComment: "",
        lintReport: { ok: true, charCount: 0, checks: [] },
      };
    });

    const failures = outcomes.filter((o) => o.error).length;
    const byTier: Record<string, number> = {};
    for (const a of finalArticles) byTier[a.tier] = (byTier[a.tier] ?? 0) + 1;
    detail.byTier = byTier;
    const notes = buildNotes(cfg, outcomes, finalArticles);
    // 🎬 doesn't count toward the 45; say how many came along and how many
    // couldn't be summarized (no captions / Supadata points).
    const vids = await unshownVideoCounts();
    if (vids.summarized || vids.other) {
      notes.push(`🎬 影音重點 ${vids.summarized} 支${vids.other ? `（另 ${vids.other} 支沒有摘要：無字幕或 Supadata 額度不足）` : ""}，不佔 45 篇名額`);
    }
    detail.notes = notes;

    // 8. Persist + dedup index.
    const digestId = await saveDigest({
      date: today,
      edition,
      title: `內容摘要日報`,
      articles: finalArticles,
      notes,
    });
    await attachVideos(digestId);
    await markUsed(
      digestId,
      finalArticles.map((a) => itemByUrl.get(a.urls[0])).filter((x): x is string => Boolean(x)),
    );

    // Cost accounting ("先量再砍"): record token/search usage + USD estimate so
    // we can trim web_search caps from real data.
    const costUSD = estimateCostUSD();
    detail.usage = { ...usage };
    detail.estimatedCostUSD = Number(costUSD.toFixed(4));
    log(
      `成本估算 ≈ $${costUSD.toFixed(4)}（${usage.calls} 次呼叫｜in ${usage.inputTokens}＋out ${usage.outputTokens} tok｜${usage.webSearches} 次搜尋）`,
    );

    // 9. Email the digest (no-op until Resend is configured; never throws).
    detail.email = await sendDigestEmail(digestId);
    log(`寄信：${detail.email}`);

    await prisma.runLog.update({
      where: { id: runId },
      data: {
        status: "success",
        finishedAt: new Date(),
        digestId,
        message: `${finalArticles.length} 篇${failures ? `（${failures} 區失敗）` : ""}｜估算 $${costUSD.toFixed(4)}${String(detail.email).startsWith("failed") ? "｜寄信失敗" : ""}`,
        detail: JSON.stringify(detail),
      },
    });

    log(`完成 ✓ digestId=${digestId}`);
    return { digestId, date: today, edition, count: finalArticles.length, failures, byTier };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    detail.email = await sendFailureEmail(runDate || todayInTz("Asia/Taipei"), message.slice(0, 300));
    await prisma.runLog.update({
      where: { id: runId },
      data: { status: "failed", finishedAt: new Date(), message, detail: JSON.stringify(detail) },
    });
    log(`失敗 ✗ ${message}（寄信：${detail.email}）`);
    throw err;
  }
}

/**
 * Drop same-event duplicates across all tiers before quotas are enforced, so
 * the spares backfill. Best effort: if the check fails, the picks ship as is.
 */
async function dropSameEventPicks<T>(
  pools: TierPool<T>[],
  describe: (t: T) => EventItem,
  log: Logger,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    const groups = await findSameEvent(pools.flatMap((p) => p.ranked.map(describe)));
    const dropped = dropSameEvent(pools, groups);
    pools.forEach((p, i) => {
      if (dropped[i]) p.deduped = dropped[i];
    });
    detail.sameEvent = groups.map((g) => g.event);
    if (groups.length) {
      log(`同一事件重複：${groups.map((g) => g.event).join("、")}（刪 ${dropped.reduce((a, b) => a + b, 0)} 則）`);
    }
  } catch (err) {
    log(`同一事件檢查失敗，略過：${errMsg(err)}`);
  }
}

/** True when an article date (YYYY-MM-DD…) is within `hours`, or unparseable. */
function isFresh(date: string, hours: number): boolean {
  const t = Date.parse(date);
  return Number.isNaN(t) || Date.now() - t <= hours * 3_600_000 + 86_400_000; // +1 day: dates have no time
}

/**
 * A tier failing is noted in the footer, but if every tier failed the run
 * itself is broken (bad API key, no credit…) — fail loudly instead of saving
 * an empty digest.
 */
function assertSomeTierWorked(pools: TierPool<unknown>[]): void {
  if (pools.length && pools.every((p) => p.error)) {
    throw new Error(`所有分區都失敗：${pools[0].error}`);
  }
}

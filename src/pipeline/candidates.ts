import { prisma } from "../lib/db";
import type { DigestConfig, GoogleNewsQuery, SearchHit, TierConfig } from "../lib/types";
import { collectQueries } from "../collect";
import { decodeGoogleNewsUrl, isGoogleNewsLink } from "../collect/gnews";
import { canonicalUrl, titleKey } from "../collect/text";

// "collected" mode: candidates come from the collector's scored items. A tier
// short on candidates is topped up with a Google News keyword search over the
// tier's `queries` (SPEC: 先從收集到的文章選，某區不夠才用搜尋補).

const POOL_FACTOR = 3; // candidates handed to the selector, × tier count

async function fromItems(tier: TierConfig, cfg: DigestConfig, knownUrls: Set<string>): Promise<SearchHit[]> {
  const since = new Date(Date.now() - cfg.search.freshnessHours * 3_600_000);
  const rows = await prisma.item.findMany({
    where: {
      tier: tier.key,
      score: { gte: cfg.sources?.minScore ?? 5 },
      digestId: null,
      OR: [{ publishedAt: { gte: since } }, { publishedAt: null, createdAt: { gte: since } }],
    },
    orderBy: [{ score: "desc" }, { publishedAt: "desc" }],
    take: tier.count * POOL_FACTOR * 2,
  });
  const seenTitles = new Set<string>();
  const out: SearchHit[] = [];
  for (const r of rows) {
    const url = r.url ?? r.link;
    if (knownUrls.has(url) || knownUrls.has(r.link)) continue;
    const key = titleKey(r.title);
    if (seenTitles.has(key)) continue; // same headline from two sources
    seenTitles.add(key);
    out.push({
      title: r.title,
      url,
      snippet: r.summary,
      sourceName: r.sourceName,
      publishedDate: (r.publishedAt ?? r.createdAt).toISOString().slice(0, 10),
      tier: tier.key,
      itemId: r.id,
    });
    if (out.length >= tier.count * POOL_FACTOR) break;
  }
  return out;
}

/** The tier's own search queries, as Google News queries. */
export function fallbackQueries(tier: TierConfig): GoogleNewsQuery[] {
  return tier.queries.map((q, i) => ({
    key: `gn-q-${tier.key}-${i}`,
    name: `${tier.label.split("：")[0]}（補搜尋）`,
    query: q,
    tiers: [tier.key],
    lang: /[㐀-鿿]/.test(q) ? "zh-TW" : "en-US",
  }));
}

export async function collectedCandidates(
  cfg: DigestConfig,
  knownUrls: Set<string>,
  log: (m: string) => void,
): Promise<Map<string, SearchHit[]>> {
  const out = new Map<string, SearchHit[]>();
  for (const tier of cfg.tiers) {
    let hits = await fromItems(tier, cfg, knownUrls);
    if (hits.length < tier.count * 2 && cfg.search.fallback !== "none") {
      log(`${tier.key} 候選只有 ${hits.length} 則，用 Google News 補搜尋`);
      try {
        await collectQueries(fallbackQueries(tier), log);
        hits = await fromItems(tier, cfg, knownUrls);
      } catch (err) {
        log(`補搜尋失敗（${tier.key}）：${err instanceof Error ? err.message : err}`);
      }
    }
    out.set(tier.key, hits);
  }
  return out;
}

/**
 * Replace Google News redirect links with original URLs (needed for full-text
 * fetch, real links in the digest, and URL dedup). Drops hits that resolve to
 * an already-published URL or duplicate another hit. Persists resolved URLs.
 */
export async function resolveLinks(
  pools: { ranked: SearchHit[] }[],
  knownUrls: Set<string>,
): Promise<void> {
  const all = pools.flatMap((p) => p.ranked).filter((h) => isGoogleNewsLink(h.url));
  const CONCURRENCY = 4;
  for (let i = 0; i < all.length; i += CONCURRENCY) {
    await Promise.all(
      all.slice(i, i + CONCURRENCY).map(async (h) => {
        const real = await decodeGoogleNewsUrl(h.url);
        if (!real) return; // keep the redirect; summary falls back to the snippet
        h.url = canonicalUrl(real);
        if (h.itemId) await prisma.item.update({ where: { id: h.itemId }, data: { url: h.url } });
      }),
    );
  }
  const seen = new Set<string>();
  for (const p of pools) {
    p.ranked = p.ranked.filter((h) => {
      if (knownUrls.has(h.url) || seen.has(h.url)) return false;
      seen.add(h.url);
      return true;
    });
  }
}

/** Mark the items behind a published digest as used. */
export async function markUsed(digestId: string, itemIds: string[]): Promise<void> {
  if (itemIds.length) {
    await prisma.item.updateMany({ where: { id: { in: itemIds } }, data: { digestId } });
  }
}

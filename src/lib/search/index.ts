import { env } from "../env";
import type { DigestConfig, SearchHit, TierKey } from "../types";
import { BraveProvider } from "./brave";
import { SerperProvider } from "./serper";
import { MockProvider } from "./mock";
import type { SearchProvider } from "./provider";

export type { SearchProvider, SearchOptions } from "./provider";

function make(name: string): SearchProvider {
  switch (name) {
    case "brave":
      return new BraveProvider();
    case "serper":
      return new SerperProvider();
    default:
      return new MockProvider();
  }
}

/**
 * Resolve the active provider. SEARCH_PROVIDER env wins (handy for forcing mock
 * in dev). Otherwise use the configured provider, falling back to mock if its
 * key is missing so the pipeline never hard-fails for a missing credential.
 */
export function resolveProvider(cfg: DigestConfig): {
  primary: SearchProvider;
  fallback?: SearchProvider;
} {
  if (env.searchProviderOverride) {
    return { primary: make(env.searchProviderOverride) };
  }
  let primary = make(cfg.search.provider);
  if (!primary.available) {
    console.warn(
      `[search] provider "${primary.name}" has no key configured — falling back to mock.`,
    );
    primary = new MockProvider();
  }
  const fallback = cfg.search.fallbackProvider
    ? make(cfg.search.fallbackProvider)
    : undefined;
  return { primary, fallback: fallback?.available ? fallback : undefined };
}

/**
 * Run every query for every tier and return hits tagged with their tier.
 * Chinese queries prefer the fallback provider (if available) per SPEC §6.
 */
export async function runSearches(cfg: DigestConfig): Promise<SearchHit[]> {
  const { primary, fallback } = resolveProvider(cfg);
  const { freshnessHours, resultsPerQuery } = cfg.search;
  const all: SearchHit[] = [];

  for (const tier of cfg.tiers) {
    for (const query of tier.queries) {
      const isZh = /[一-鿿]/.test(query);
      // Chinese coverage: try fallback (Google SERP) first when available.
      const provider = isZh && fallback ? fallback : primary;
      const lang = isZh ? "zh-hant" : "en";
      try {
        const hits = await provider.search(query, {
          freshnessHours,
          count: resultsPerQuery,
          lang,
        });
        for (const h of hits) all.push({ ...h, tier: tier.key as TierKey });
      } catch (err) {
        console.error(`[search] "${query}" via ${provider.name} failed:`, err);
      }
    }
  }
  return all;
}

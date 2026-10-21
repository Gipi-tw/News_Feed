import type { TierKey } from "../lib/types";

// Cheap first-pass filter before any LLM sees an item: a tier-dedicated source
// always counts; a general source only when a tier keyword appears.

export type KeywordMatcher = (text: string) => TierKey[];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function keywordMatcher(keywords: Partial<Record<TierKey, string[]>>): KeywordMatcher {
  const rules = Object.entries(keywords).map(([tier, words]) => {
    const ascii = (words ?? []).filter((w) => /^[\x20-\x7e]+$/.test(w));
    const cjk = (words ?? []).filter((w) => !/^[\x20-\x7e]+$/.test(w));
    // Word boundaries keep "Intel" out of "intelligence" and "Meta" out of "metadata".
    const re = ascii.length ? new RegExp(`(?<![\\w'])(?:${ascii.map(escape).join("|")})(?![\\w])`, "i") : null;
    return { tier: tier as TierKey, re, cjk };
  });
  return (text: string) =>
    rules.filter((r) => r.re?.test(text) || r.cjk.some((w) => text.includes(w))).map((r) => r.tier);
}

/** Tier hints for one item: the source's own tiers plus keyword matches. */
export function tierHints(sourceTiers: TierKey[] | undefined, text: string, match: KeywordMatcher): TierKey[] {
  return [...new Set([...(sourceTiers ?? []), ...match(text)])];
}

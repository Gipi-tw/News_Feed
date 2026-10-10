import type { TagRule } from "../lib/types";

// Deterministic quota enforcement (SPEC: hard caps that feedback can't
// override). The selector returns a ranked pool per tier with topic tags; this
// module decides what actually ships:
//   1. per tier: satisfy `min` rules first (best-ranked tagged items), then fill
//      by rank, never exceeding a `max` rule;
//   2. across tiers: while a global `max` is exceeded, tighten that tag's max on
//      the tier holding the most tagged items and re-pick it (which backfills
//      with untagged items from that tier's pool when there are any).
// Shortfalls are reported rather than padded (寧缺勿濫).

export interface Tagged {
  tags: string[];
}

export interface TierPick<T extends Tagged> {
  picked: T[];
  unmetMins: { rule: TagRule; got: number }[];
}

const countTag = (items: Tagged[], tag: string) =>
  items.reduce((n, t) => n + (t.tags.includes(tag) ? 1 : 0), 0);

/** Pick up to `count` items from a ranked pool, honoring min/max tag rules. */
export function pickWithRules<T extends Tagged>(
  ranked: T[],
  count: number,
  rules: TagRule[] = [],
): TierPick<T> {
  const maxRules = rules.filter((r) => r.max != null);
  const counts = new Map<string, number>();
  const chosen = new Set<T>();
  const fits = (t: T) =>
    maxRules.every((r) => !t.tags.includes(r.tag) || (counts.get(r.tag) ?? 0) < r.max!);
  const take = (t: T) => {
    chosen.add(t);
    for (const tag of new Set(t.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  };

  for (const rule of rules.filter((r) => r.min != null)) {
    for (const t of ranked) {
      if (chosen.size >= count || (counts.get(rule.tag) ?? 0) >= rule.min!) break;
      if (!chosen.has(t) && t.tags.includes(rule.tag) && fits(t)) take(t);
    }
  }
  for (const t of ranked) {
    if (chosen.size >= count) break;
    if (!chosen.has(t) && fits(t)) take(t);
  }

  return {
    picked: ranked.filter((t) => chosen.has(t)), // keep rank order
    unmetMins: rules
      .filter((r) => r.min != null && (counts.get(r.tag) ?? 0) < r.min)
      .map((rule) => ({ rule, got: counts.get(rule.tag) ?? 0 })),
  };
}

/** Return `rules` with `tag` capped at `max` (keeping any tighter cap). */
export function withMax(rules: TagRule[], tag: string, max: number, desc = tag): TagRule[] {
  const existing = rules.find((r) => r.tag === tag && r.max != null);
  if (existing && existing.max! <= max) return rules;
  return [...rules.filter((r) => r !== existing), { tag, desc: existing?.desc ?? desc, max }];
}

export interface TierInput<T extends Tagged> {
  key: string;
  ranked: T[];
  count: number;
  rules?: TagRule[];
}

export interface TierResult<T extends Tagged> extends TierPick<T> {
  key: string;
  /** Global-cap tightenings applied to this tier, e.g. "ai ≤ 3". */
  trimmed: { tag: string; max: number }[];
}

/** Enforce per-tier rules, then global max rules across tiers. */
export function enforceQuotas<T extends Tagged>(
  tiers: TierInput<T>[],
  globalRules: TagRule[] = [],
): TierResult<T>[] {
  const rules = tiers.map((t) => t.rules ?? []);
  const results: TierResult<T>[] = tiers.map((t, i) => ({
    key: t.key,
    trimmed: [],
    ...pickWithRules(t.ranked, t.count, rules[i]),
  }));

  for (const g of globalRules.filter((r) => r.max != null)) {
    // Each pass lowers one tier's cap by one, so this terminates.
    for (;;) {
      const tagged = results.map((r) => countTag(r.picked, g.tag));
      if (tagged.reduce((a, b) => a + b, 0) <= g.max!) break;
      let worst = 0;
      tagged.forEach((n, i) => {
        if (n >= tagged[worst]) worst = i; // ties → later tier
      });
      const cap = tagged[worst] - 1;
      rules[worst] = withMax(rules[worst], g.tag, cap, g.desc);
      const repicked = pickWithRules(tiers[worst].ranked, tiers[worst].count, rules[worst]);
      results[worst] = {
        ...results[worst],
        ...repicked,
        trimmed: [...results[worst].trimmed.filter((x) => x.tag !== g.tag), { tag: g.tag, max: cap }],
      };
    }
  }
  return results;
}

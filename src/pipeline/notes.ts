import type { DigestConfig, TagRule, TierConfig } from "../lib/types";

// Footer notes (SPEC 寧缺勿濫): when a tier ships short, or a quota bent the
// selection, say how many and why — never pad silently.

export interface TierOutcome {
  tier: TierConfig;
  shortfallNote: string;
  unmetMins: { rule: TagRule; got: number }[];
  trimmed: { tag: string; max: number }[];
  error?: string;
}

const short = (t: TierConfig) => `${t.emoji} ${t.label.split("：")[0]}`;
const shortDesc = (r: TagRule) => r.desc.split("：")[0];

export function buildNotes(
  cfg: DigestConfig,
  outcomes: TierOutcome[],
  shipped: { tier: string; tags: string[] }[],
): string[] {
  const notes: string[] = [];
  const tagName = (tag: string, tier: TierConfig) => {
    const r = [...(cfg.globalRules ?? []), ...(tier.rules ?? [])].find((x) => x.tag === tag);
    return r ? shortDesc(r) : tag;
  };
  for (const o of outcomes) {
    const n = shipped.filter((a) => a.tier === o.tier.key).length;
    const quotaReasons = [
      ...o.unmetMins.map((u) => `${shortDesc(u.rule)}只有 ${u.got} 則（目標至少 ${u.rule.min}）`),
      ...o.trimmed.map((t) => `為守全份上限，本區「${tagName(t.tag, o.tier)}」壓到 ${t.max} 則`),
    ];
    if (n < o.tier.count) {
      const reasons = [
        o.error ? `本區產生失敗（${o.error}）` : "",
        o.shortfallNote.trim(),
        ...quotaReasons,
      ].filter(Boolean);
      notes.push(`${short(o.tier)} ${n}/${o.tier.count} 篇：${reasons.join("；") || "夠格內容不足，寧缺勿濫"}`);
    } else if (quotaReasons.length) {
      notes.push(`${short(o.tier)}：${quotaReasons.join("；")}`);
    }
  }
  for (const g of cfg.globalRules ?? []) {
    if (g.max == null) continue;
    const n = shipped.filter((a) => a.tags.includes(g.tag)).length;
    notes.push(`全份「${shortDesc(g)}」${n} 則（上限 ${g.max}）`);
  }
  return notes;
}

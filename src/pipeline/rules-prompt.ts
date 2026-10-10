import type { DigestConfig, TagRule, TierConfig } from "../lib/types";

// Shared prompt fragments for tag-based quotas, so the selector (search mode)
// and the researcher (Claude web_search mode) tag picks the same way.

/** Every tag this tier's picks may carry: global tags first, then tier tags. */
export function tierTags(tier: TierConfig, cfg: DigestConfig): TagRule[] {
  const seen = new Set<string>();
  const out: TagRule[] = [];
  for (const r of [...(cfg.globalRules ?? []), ...(tier.rules ?? [])]) {
    if (seen.has(r.tag)) continue;
    seen.add(r.tag);
    out.push(r);
  }
  return out;
}

/** Bullet list explaining tags and this tier's quotas, for the user prompt. */
export function rulesPrompt(tier: TierConfig, cfg: DigestConfig): string {
  const tags = tierTags(tier, cfg);
  if (!tags.length) return "";
  const quota = (r: TagRule) =>
    [r.min != null ? `至少 ${r.min} 則` : "", r.max != null ? `最多 ${r.max} 則` : ""]
      .filter(Boolean)
      .join("、");
  const tierRules = (tier.rules ?? []).filter((r) => r.min != null || r.max != null);
  return `# 主題標籤（每則候選都要標，符合才標，可多個或零個）
${tags.map((t) => `- ${t.tag}：${t.desc}`).join("\n")}

# 本區硬性配額（程式會強制執行，回饋也不能推翻）
${tierRules.length ? tierRules.map((r) => `- ${r.tag}：${quota(r)}`).join("\n") : "- （無）"}
- 全份「以 AI 為主軸」上限 ${cfg.globalRules?.find((r) => r.tag === "ai")?.max ?? "—"} 則；不要拿 AI 新聞硬湊篇數。`;
}

/** JSON-schema fragment for a `tags` array restricted to this tier's tags. */
export function tagsSchema(tier: TierConfig, cfg: DigestConfig) {
  const tags = tierTags(tier, cfg).map((t) => t.tag);
  return {
    type: "array",
    items: tags.length ? { type: "string", enum: tags } : { type: "string" },
  } as const;
}

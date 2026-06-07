import { MODELS, generateJSON } from "../lib/anthropic";
import type { DigestConfig, SearchHit, TierConfig } from "../lib/types";

// Stage 1: choose the best `count` candidates for a tier from the search hits.
// Snippet-based (full text is fetched only for the winners), so the prompt
// stays small even with many candidates.

const SELECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    selected: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          reason: { type: "string" },
        },
        required: ["url", "title", "reason"],
      },
    },
  },
  required: ["selected"],
} as const;

interface SelectResult {
  selected: { url: string; title: string; reason: string }[];
}

export async function selectForTier(opts: {
  tier: TierConfig;
  candidates: SearchHit[];
  recentTitles: string[];
  interestProfile: string;
  today: string;
  cfg: DigestConfig;
}): Promise<SearchHit[]> {
  const { tier, candidates, recentTitles, interestProfile, today, cfg } = opts;
  if (candidates.length === 0) return [];

  const list = candidates
    .map(
      (c, i) =>
        `[${i}] ${c.title}\n    來源：${c.sourceName ?? "?"}｜日期：${c.publishedDate ?? "?"}｜${c.url}\n    摘要：${(c.snippet ?? "").slice(0, 300)}`,
    )
    .join("\n");

  const system =
    "你是游舒帆（Gipi）的個人內容策展編輯。今天是 " +
    today +
    "（台北時間）。你的任務是依他的興趣輪廓，從候選新聞中挑出最值得他關注、可發揮成貼文的文章。" +
    "嚴格遵守區塊定位與全域排除規則。同一事件（不同來源）只選一則；若是某持續事件的「新進展」可收錄並聚焦增量。";

  const user = `# 本區塊：${tier.emoji} ${tier.label}
定位與切角：${tier.scope}
需要篩選出：${tier.count} 則（不足則盡量接近）

# 全域排除規則（命中則不選）
${cfg.globalExclusions.map((e) => `- ${e}`).join("\n")}

# 興趣輪廓（節錄，用於判斷相關性）
${interestProfile.slice(0, 3500)}

# 近 30 天已發過的標題（避免重複，同事件除非有新進展）
${recentTitles.length ? recentTitles.map((t) => `- ${t}`).join("\n") : "（無）"}

# 候選新聞（共 ${candidates.length} 則）
${list}

請從候選中挑出最多 ${tier.count} 則最符合本區塊定位、最值得游舒帆評論的文章。
回傳每則的 url（必須是候選清單中的原始 url）、title、以及一句挑選理由。按重要性排序。`;

  const result = await generateJSON<SelectResult>({
    model: MODELS.select,
    system,
    user,
    schema: SELECT_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 4000,
  });

  // Map chosen urls back to the original hits; dedupe; cap at count.
  const byUrl = new Map(candidates.map((c) => [c.url, c]));
  const picked: SearchHit[] = [];
  const seen = new Set<string>();
  for (const s of result.selected) {
    const hit = byUrl.get(s.url);
    if (hit && !seen.has(hit.url)) {
      seen.add(hit.url);
      picked.push(hit);
    }
    if (picked.length >= tier.count) break;
  }
  return picked;
}
